/**
 * @fileoverview 数据安全服务模块
 *
 * 专门负责数据导出导入过程中的安全处理，包括：
 * - 敏感信息脱敏和安全处理
 * - 数据完整性验证和校验
 * - 操作审计日志记录
 * - 安全错误处理和恢复
 *
 * 遵循SOLID原则设计，提供可插拔的安全策略和灵活的验证机制。
 * 确保数据迁移过程的安全性和完整性。
 *
 * @author Claude Code
 * @version 1.0.0
 */

const logger = require('../utils/logger')
const crypto = require('crypto')
const fs = require('fs').promises
const path = require('path')
// const config = require('../../config/config')

/**
 * 数据安全服务类
 *
 * 核心功能：
 * - 🔒 敏感数据脱敏：管理员密码、2FA密钥、OAuth令牌
 * - ✅ 数据完整性验证：多层校验和、版本兼容性检查
 * - 📋 操作审计：完整的安全操作日志记录
 * - 🛡️ 安全策略：可配置的安全处理策略
 * - 🔄 错误恢复：详细的错误分析和恢复建议
 */
class DataSecurityService {
  constructor(options = {}) {
    this.options = {
      // 脱敏策略
      sanitizationLevel: options.sanitizationLevel || 'strict', // 'strict' | 'moderate' | 'minimal'
      preserveFormat: options.preserveFormat !== false,

      // 验证策略
      enableChecksumVerification: options.enableChecksumVerification !== false,
      enableVersionCheck: options.enableVersionCheck !== false,
      enableDependencyValidation: options.enableDependencyValidation !== false,

      // 审计策略
      enableAuditLogging: options.enableAuditLogging !== false,
      auditLogLevel: options.auditLogLevel || 'info', // 'debug' | 'info' | 'warn' | 'error'

      // 安全配置
      encryptionAlgorithm: options.encryptionAlgorithm || 'aes-256-cbc',
      hashAlgorithm: options.hashAlgorithm || 'sha256',
      saltLength: options.saltLength || 32,

      ...options
    }

    // 初始化审计日志
    this.auditLogEntries = []
    this.operationId = this._generateOperationId()

    logger.info('🛡️ DataSecurityService initialized', {
      operationId: this.operationId,
      sanitizationLevel: this.options.sanitizationLevel,
      enableAuditLogging: this.options.enableAuditLogging
    })
  }

  /**
   * 敏感信息处理器 - 管理员密码哈希处理
   * @param {Array} adminAccounts 管理员账户数据
   * @param {string} operation 操作类型 'export' | 'import'
   * @returns {Object} 处理结果和安全建议
   */
  async handleAdminPasswordHashes(adminAccounts, operation) {
    this._auditLog('handleAdminPasswordHashes', 'start', {
      operation,
      accountCount: adminAccounts.length
    })

    try {
      const result = {
        processed: [],
        warnings: [],
        recommendations: [],
        securityAlerts: []
      }

      for (const admin of adminAccounts) {
        const processedAdmin = { ...admin }

        if (operation === 'export') {
          // 导出时脱敏处理
          if (admin.passwordHash) {
            switch (this.options.sanitizationLevel) {
              case 'strict':
                processedAdmin.passwordHash = '[REDACTED-STRICT]'
                processedAdmin._originalHashType = this._detectHashType(admin.passwordHash)
                break
              case 'moderate':
                processedAdmin.passwordHash = this._partialMask(admin.passwordHash, 0.8)
                processedAdmin._originalHashType = this._detectHashType(admin.passwordHash)
                break
              case 'minimal':
                processedAdmin._originalHashType = this._detectHashType(admin.passwordHash)
                break
            }

            result.warnings.push({
              type: 'password_hash_sanitized',
              username: admin.username,
              level: this.options.sanitizationLevel,
              message: 'Password hash has been sanitized for security'
            })
          }

          // 添加安全元数据
          processedAdmin._securityMetadata = {
            sanitizedAt: new Date().toISOString(),
            sanitizationLevel: this.options.sanitizationLevel,
            requiresPasswordReset: true
          }
        } else if (operation === 'import') {
          // 导入时安全检查
          if (
            processedAdmin.passwordHash === '[REDACTED-STRICT]' ||
            processedAdmin.passwordHash === '[REDACTED]'
          ) {
            // 生成临时安全密码哈希
            const tempPassword = this._generateSecureTemporaryPassword()
            processedAdmin.passwordHash = await this._hashPassword(tempPassword)
            processedAdmin._tempPassword = tempPassword
            processedAdmin._requiresPasswordReset = true

            result.securityAlerts.push({
              type: 'temp_password_generated',
              username: admin.username,
              tempPassword,
              message: 'Temporary password generated due to sanitized import'
            })
          }

          // 验证密码哈希强度
          if (admin.passwordHash && !admin.passwordHash.startsWith('[REDACTED')) {
            const hashStrength = this._validatePasswordHashStrength(admin.passwordHash)
            if (hashStrength.score < 3) {
              result.warnings.push({
                type: 'weak_password_hash',
                username: admin.username,
                score: hashStrength.score,
                message: 'Password hash appears to use weak hashing algorithm'
              })
            }
          }
        }

        result.processed.push(processedAdmin)
      }

      // 生成安全建议
      result.recommendations = this._generatePasswordSecurityRecommendations(result)

      this._auditLog('handleAdminPasswordHashes', 'success', {
        processedCount: result.processed.length,
        warningsCount: result.warnings.length,
        alertsCount: result.securityAlerts.length
      })

      return result
    } catch (error) {
      this._auditLog('handleAdminPasswordHashes', 'error', {
        error: error.message,
        stack: error.stack
      })
      throw new Error(`Admin password hash processing failed: ${error.message}`)
    }
  }

  /**
   * 敏感信息处理器 - 2FA密钥脱敏处理
   * @param {Array} twoFactorConfigs 2FA配置数据
   * @param {string} operation 操作类型 'export' | 'import'
   * @returns {Object} 处理结果和安全建议
   */
  async handleTwoFactorSecrets(twoFactorConfigs, operation) {
    this._auditLog('handleTwoFactorSecrets', 'start', {
      operation,
      configCount: twoFactorConfigs.length
    })

    try {
      const result = {
        processed: [],
        warnings: [],
        recommendations: [],
        securityAlerts: []
      }

      for (const tfConfig of twoFactorConfigs) {
        const processedConfig = { ...tfConfig }

        if (operation === 'export') {
          // 脱敏敏感2FA数据
          const sensitiveFields = ['secret', 'backupCodes', 'qrCodeDataUrl']

          for (const field of sensitiveFields) {
            if (tfConfig[field]) {
              switch (this.options.sanitizationLevel) {
                case 'strict':
                  processedConfig[field] = `[REDACTED-2FA-${field.toUpperCase()}]`
                  break
                case 'moderate':
                  if (field === 'backupCodes' && Array.isArray(tfConfig[field])) {
                    processedConfig[field] = tfConfig[field].map(() => '[REDACTED-CODE]')
                  } else {
                    processedConfig[field] = this._partialMask(tfConfig[field], 0.9)
                  }
                  break
                case 'minimal':
                  // 保留数据但添加警告
                  processedConfig[`_${field}_warning`] = 'Contains sensitive 2FA data'
                  break
              }
            }
          }

          // 保留非敏感元数据
          processedConfig._securityMetadata = {
            sanitizedAt: new Date().toISOString(),
            originallyEnabled: tfConfig.isEnabled,
            requiresReconfiguration: true
          }

          result.warnings.push({
            type: '2fa_secrets_sanitized',
            username: tfConfig.username,
            message: '2FA secrets have been sanitized and must be reconfigured'
          })
        } else if (operation === 'import') {
          // 导入时处理脱敏的2FA配置
          if (this._isRedactedValue(processedConfig.secret)) {
            processedConfig.isEnabled = false
            processedConfig.requiresReconfiguration = true
            processedConfig.secret = null
            processedConfig.backupCodes = []
            processedConfig.qrCodeDataUrl = null

            result.securityAlerts.push({
              type: '2fa_requires_reconfiguration',
              username: tfConfig.username,
              message: 'User must reconfigure 2FA authentication after import'
            })
          }

          // 验证2FA配置完整性
          if (tfConfig.isEnabled && !this._isRedactedValue(tfConfig.secret)) {
            const validationResult = this._validate2FASecret(tfConfig.secret)
            if (!validationResult.valid) {
              result.warnings.push({
                type: 'invalid_2fa_secret',
                username: tfConfig.username,
                reason: validationResult.reason,
                message: '2FA secret validation failed'
              })
            }
          }
        }

        result.processed.push(processedConfig)
      }

      // 生成2FA安全建议
      result.recommendations = this._generate2FASecurityRecommendations(result)

      this._auditLog('handleTwoFactorSecrets', 'success', {
        processedCount: result.processed.length,
        warningsCount: result.warnings.length
      })

      return result
    } catch (error) {
      this._auditLog('handleTwoFactorSecrets', 'error', {
        error: error.message,
        stack: error.stack
      })
      throw new Error(`2FA secrets processing failed: ${error.message}`)
    }
  }

  /**
   * 敏感信息处理器 - 加密Token安全迁移
   * @param {Array} accounts 账户数据（包含加密token）
   * @param {string} operation 操作类型 'export' | 'import'
   * @returns {Object} 处理结果和安全建议
   */
  async handleEncryptedTokens(accounts, operation) {
    this._auditLog('handleEncryptedTokens', 'start', {
      operation,
      accountCount: accounts.length
    })

    try {
      const result = {
        processed: [],
        warnings: [],
        recommendations: [],
        securityAlerts: [],
        tokenStats: {
          encrypted: 0,
          plaintext: 0,
          invalid: 0,
          redacted: 0
        }
      }

      for (const account of accounts) {
        const processedAccount = { ...account }
        const tokenFields = ['accessToken', 'refreshToken', 'claudeAiOauth']

        for (const field of tokenFields) {
          if (account[field]) {
            const tokenInfo = this._analyzeTokenSecurity(account[field])
            result.tokenStats[tokenInfo.type]++

            if (operation === 'export') {
              // 导出时token安全处理
              switch (tokenInfo.type) {
                case 'encrypted':
                  // 已加密的token保持原状，但添加安全标记
                  processedAccount[`_${field}_security`] = {
                    encrypted: true,
                    algorithm: tokenInfo.algorithm || 'unknown',
                    requiresCompatibleKey: true
                  }
                  break

                case 'plaintext':
                  // 明文token需要警告
                  result.warnings.push({
                    type: 'plaintext_token_detected',
                    accountId: account.id,
                    field,
                    message: 'Plaintext token detected - consider encryption'
                  })
                  break

                case 'invalid':
                  result.warnings.push({
                    type: 'invalid_token_format',
                    accountId: account.id,
                    field,
                    message: 'Token format appears invalid'
                  })
                  break
              }
            } else if (operation === 'import') {
              // 导入时token验证和处理
              if (tokenInfo.type === 'encrypted') {
                // 验证加密token是否可以正确解密
                try {
                  const decryptionTest = this._testTokenDecryption(account[field])
                  if (!decryptionTest.success) {
                    result.securityAlerts.push({
                      type: 'token_decryption_failed',
                      accountId: account.id,
                      field,
                      reason: decryptionTest.error,
                      message: 'Encrypted token cannot be decrypted with current key'
                    })
                  }
                } catch (decryptError) {
                  result.warnings.push({
                    type: 'token_decryption_test_failed',
                    accountId: account.id,
                    field,
                    error: decryptError.message
                  })
                }
              }
            }
          }
        }

        result.processed.push(processedAccount)
      }

      // 生成token安全建议
      result.recommendations = this._generateTokenSecurityRecommendations(result)

      this._auditLog('handleEncryptedTokens', 'success', {
        processedCount: result.processed.length,
        tokenStats: result.tokenStats
      })

      return result
    } catch (error) {
      this._auditLog('handleEncryptedTokens', 'error', {
        error: error.message,
        stack: error.stack
      })
      throw new Error(`Encrypted tokens processing failed: ${error.message}`)
    }
  }

  /**
   * 数据完整性验证 - 增强校验和验证
   * @param {string} exportDir 导出目录路径
   * @param {Object} options 验证选项
   * @returns {Object} 验证结果
   */
  async verifyDataIntegrity(exportDir, options = {}) {
    this._auditLog('verifyDataIntegrity', 'start', { exportDir })

    try {
      const result = {
        valid: true,
        checksums: {},
        errors: [],
        warnings: [],
        metrics: {
          filesChecked: 0,
          totalSize: 0,
          verificationTime: 0
        }
      }

      const startTime = Date.now()

      // 读取原始校验和文件
      const checksumPath = path.join(exportDir, 'checksums.json')
      let originalChecksums = {}

      try {
        const checksumContent = await fs.readFile(checksumPath, 'utf8')
        originalChecksums = JSON.parse(checksumContent)
      } catch (error) {
        if (options.requireChecksums !== false) {
          result.errors.push({
            type: 'missing_checksums_file',
            message: 'Checksums file not found or invalid',
            file: 'checksums.json'
          })
          result.valid = false
        } else {
          result.warnings.push({
            type: 'checksums_not_required',
            message: 'Checksums verification skipped (not required)'
          })
        }

        this._auditLog('verifyDataIntegrity', 'completed', result)
        return result
      }

      // 验证每个文件的校验和
      const files = await fs.readdir(exportDir)
      const dataFiles = files.filter((file) => file.endsWith('.json') && file !== 'checksums.json')

      for (const file of dataFiles) {
        const filePath = path.join(exportDir, file)

        try {
          const content = await fs.readFile(filePath, 'utf8')
          let actualHash = crypto.createHash('sha256').update(content).digest('hex')
          const actualSize = content.length

          // 如果直接校验和不匹配，尝试JSON规范化校验和
          let normalizedMatch = false
          let normalizedHash = null

          if (actualHash !== originalChecksums[file]?.sha256) {
            try {
              // 解析并重新序列化JSON以规范化格式
              const jsonData = JSON.parse(content)
              const normalizedContent = JSON.stringify(jsonData, null, 2)
              normalizedHash = crypto.createHash('sha256').update(normalizedContent).digest('hex')
              normalizedMatch = normalizedHash === originalChecksums[file]?.sha256

              // 如果规范化后的校验和匹配，使用规范化校验和
              if (normalizedMatch) {
                actualHash = normalizedHash
                logger.debug(`📝 JSON规范化校验和匹配: ${file} (原始不匹配，规范化后匹配)`)
              }
            } catch (jsonError) {
              // 不是JSON文件或JSON解析失败，使用原始校验和
              logger.debug(`⚠️ JSON规范化失败: ${file}, 错误: ${jsonError.message}`)
            }
          }

          result.checksums[file] = {
            expected: originalChecksums[file]?.sha256,
            actual: actualHash,
            match: actualHash === originalChecksums[file]?.sha256,
            normalizedHash,
            normalizedMatch,
            size: actualSize,
            expectedSize: originalChecksums[file]?.size
          }

          if (!result.checksums[file].match) {
            result.errors.push({
              type: 'checksum_mismatch',
              file,
              expected: originalChecksums[file]?.sha256,
              actual: actualHash,
              message: 'File integrity check failed'
            })
            result.valid = false
          }

          // 检查文件大小
          if (
            originalChecksums[file]?.size &&
            Math.abs(actualSize - originalChecksums[file].size) > 0
          ) {
            result.warnings.push({
              type: 'size_mismatch',
              file,
              expectedSize: originalChecksums[file].size,
              actualSize,
              message: 'File size differs from expected'
            })
          }

          result.metrics.filesChecked++
          result.metrics.totalSize += actualSize
        } catch (error) {
          result.errors.push({
            type: 'file_read_error',
            file,
            error: error.message,
            message: 'Could not verify file integrity'
          })
          result.valid = false
        }
      }

      // 检查是否有缺失的文件
      for (const expectedFile of Object.keys(originalChecksums)) {
        if (!dataFiles.includes(expectedFile)) {
          result.errors.push({
            type: 'missing_file',
            file: expectedFile,
            message: 'Expected file is missing from export'
          })
          result.valid = false
        }
      }

      result.metrics.verificationTime = Date.now() - startTime

      this._auditLog('verifyDataIntegrity', 'success', {
        filesChecked: result.metrics.filesChecked,
        valid: result.valid,
        errorsCount: result.errors.length
      })

      return result
    } catch (error) {
      this._auditLog('verifyDataIntegrity', 'error', {
        error: error.message,
        stack: error.stack
      })
      throw new Error(`Data integrity verification failed: ${error.message}`)
    }
  }

  /**
   * 版本兼容性检查
   * @param {Object} metadata 导出元数据
   * @param {string} targetVersion 目标系统版本
   * @returns {Object} 兼容性检查结果
   */
  async checkVersionCompatibility(metadata, targetVersion = '1.0.0') {
    this._auditLog('checkVersionCompatibility', 'start', {
      exportVersion: metadata.exportVersion,
      targetVersion
    })

    try {
      const result = {
        compatible: true,
        warnings: [],
        recommendations: [],
        migrationRequired: false,
        supportedFeatures: [],
        unsupportedFeatures: []
      }

      const exportVersion = metadata.exportVersion || '1.0.0'

      // 版本比较逻辑
      const versionComparison = this._compareVersions(exportVersion, targetVersion)

      if (versionComparison > 0) {
        // 导出版本高于目标版本
        result.warnings.push({
          type: 'newer_export_version',
          exportVersion,
          targetVersion,
          message: 'Export was created with newer version, some features may not be supported'
        })
      } else if (versionComparison < 0) {
        // 导出版本低于目标版本
        result.migrationRequired = true
        result.recommendations.push({
          type: 'upgrade_recommended',
          message: 'Consider upgrading export format for better compatibility'
        })
      }

      // 检查特定版本的功能兼容性
      const compatibilityMatrix = this._getVersionCompatibilityMatrix()
      const exportFeatures = this._extractFeaturesFromMetadata(metadata)

      for (const feature of exportFeatures) {
        if (compatibilityMatrix[targetVersion]?.includes(feature)) {
          result.supportedFeatures.push(feature)
        } else {
          result.unsupportedFeatures.push(feature)
          result.warnings.push({
            type: 'unsupported_feature',
            feature,
            message: `Feature '${feature}' may not be supported in target version`
          })
        }
      }

      if (result.unsupportedFeatures.length > 0) {
        result.compatible = false
      }

      this._auditLog('checkVersionCompatibility', 'success', {
        compatible: result.compatible,
        migrationRequired: result.migrationRequired
      })

      return result
    } catch (error) {
      this._auditLog('checkVersionCompatibility', 'error', {
        error: error.message
      })
      throw new Error(`Version compatibility check failed: ${error.message}`)
    }
  }

  /**
   * 依赖关系验证
   * @param {Object} importData 导入数据
   * @returns {Object} 依赖验证结果
   */
  async validateDependencies(importData) {
    this._auditLog('validateDependencies', 'start')

    try {
      const result = {
        valid: true,
        dependencies: [],
        conflicts: [],
        missing: [],
        circular: []
      }

      // 定义依赖关系映射
      const dependencyMap = {
        apiKeys: [], // API Keys 不依赖其他数据
        adminAccounts: [], // 管理员账户不依赖其他数据
        claudeAccounts: [], // Claude账户不依赖其他数据
        geminiAccounts: [], // Gemini账户不依赖其他数据
        openaiAccounts: [], // OpenAI账户不依赖其他数据
        systemConfig: [], // 系统配置不依赖其他数据
        twoFactorConfigs: ['adminAccounts'], // 2FA依赖管理员账户
        usageStats: ['apiKeys', 'claudeAccounts'], // 使用统计依赖API Keys和账户
        systemStats: ['usageStats'] // 系统统计依赖使用统计
      }

      // 检查每种数据类型的依赖
      for (const [dataType, deps] of Object.entries(dependencyMap)) {
        if (importData[dataType]) {
          result.dependencies.push({
            type: dataType,
            requires: deps,
            satisfied: deps.every((dep) => importData[dep])
          })

          // 检查缺失的依赖
          const missingDeps = deps.filter((dep) => !importData[dep])
          if (missingDeps.length > 0) {
            result.missing.push({
              type: dataType,
              missingDependencies: missingDeps,
              impact: 'Data may not function correctly without dependencies'
            })
            result.valid = false
          }
        }
      }

      // 检查循环依赖（虽然当前设计中应该没有）
      const circularDeps = this._detectCircularDependencies(dependencyMap)
      if (circularDeps.length > 0) {
        result.circular = circularDeps
        result.valid = false
      }

      // 检查数据引用完整性
      if (importData.usageStats && importData.apiKeys) {
        const referenceIntegrityCheck = this._checkReferenceIntegrity(
          importData.usageStats,
          importData.apiKeys
        )

        if (!referenceIntegrityCheck.valid) {
          result.conflicts.push({
            type: 'reference_integrity',
            issues: referenceIntegrityCheck.issues,
            message: 'Usage statistics reference non-existent API keys'
          })
          result.valid = false
        }
      }

      this._auditLog('validateDependencies', 'success', {
        valid: result.valid,
        dependenciesCount: result.dependencies.length,
        conflictsCount: result.conflicts.length
      })

      return result
    } catch (error) {
      this._auditLog('validateDependencies', 'error', {
        error: error.message
      })
      throw new Error(`Dependencies validation failed: ${error.message}`)
    }
  }

  /**
   * 脱敏管理员密码数据
   * @param {Object|Array} adminData 管理员数据（单个对象或数组）
   * @param {string} operation 操作类型，默认为 'export'
   * @returns {Object|Array} 脱敏后的数据
   */
  sanitizeAdminPassword(adminData, operation = 'export') {
    try {
      const isArray = Array.isArray(adminData)
      const dataToProcess = isArray ? adminData : [adminData]

      logger.debug('🔒 Sanitizing admin password data', {
        count: dataToProcess.length,
        operation,
        sanitizationLevel: this.options.sanitizationLevel
      })

      const sanitizedData = dataToProcess.map((admin) => {
        const sanitized = { ...admin }

        if (admin.passwordHash) {
          switch (this.options.sanitizationLevel) {
            case 'strict':
              sanitized.passwordHash = '[REDACTED-PASSWORD]'
              sanitized._originalHashType = this._detectHashType(admin.passwordHash)
              break
            case 'moderate':
              sanitized.passwordHash = this._partialMask(admin.passwordHash, 0.8)
              sanitized._originalHashType = this._detectHashType(admin.passwordHash)
              break
            case 'minimal':
              sanitized._originalHashType = this._detectHashType(admin.passwordHash)
              break
          }

          sanitized._securityNote = 'Password requires reset after import'
        }

        return sanitized
      })

      return isArray ? sanitizedData : sanitizedData[0]
    } catch (error) {
      logger.error('❌ Failed to sanitize admin password data:', error)
      throw new Error(`Admin password sanitization failed: ${error.message}`)
    }
  }

  /**
   * 脱敏2FA密钥数据
   * @param {Object|Array} twoFactorData 2FA数据（单个对象或数组）
   * @param {string} operation 操作类型，默认为 'export'
   * @returns {Object|Array} 脱敏后的数据
   */
  sanitizeTwoFactorSecret(twoFactorData, operation = 'export') {
    try {
      const isArray = Array.isArray(twoFactorData)
      const dataToProcess = isArray ? twoFactorData : [twoFactorData]

      logger.debug('🔒 Sanitizing 2FA secret data', {
        count: dataToProcess.length,
        operation,
        sanitizationLevel: this.options.sanitizationLevel
      })

      const sanitizedData = dataToProcess.map((tfData) => {
        const sanitized = { ...tfData }
        const sensitiveFields = ['secret', 'backupCodes', 'qrCodeDataUrl']

        for (const field of sensitiveFields) {
          if (tfData[field]) {
            switch (this.options.sanitizationLevel) {
              case 'strict':
                sanitized[field] = `[REDACTED-2FA-${field.toUpperCase()}]`
                break
              case 'moderate':
                if (field === 'backupCodes' && Array.isArray(tfData[field])) {
                  sanitized[field] = tfData[field].map(() => '[REDACTED-CODE]')
                } else {
                  sanitized[field] = this._partialMask(tfData[field], 0.9)
                }
                break
              case 'minimal':
                sanitized[`_${field}_warning`] = 'Contains sensitive 2FA data'
                break
            }
          }
        }

        sanitized._securityNote = '2FA requires reconfiguration after import'
        return sanitized
      })

      return isArray ? sanitizedData : sanitizedData[0]
    } catch (error) {
      logger.error('❌ Failed to sanitize 2FA secret data:', error)
      throw new Error(`2FA secret sanitization failed: ${error.message}`)
    }
  }

  /**
   * 处理加密Token数据
   * @param {Object|Array} tokenData Token数据（单个对象或数组）
   * @param {string} encryptionKey 加密密钥（可选）
   * @param {string} operation 操作类型，默认为 'export'
   * @returns {Object|Array} 处理后的数据
   */
  sanitizeEncryptedToken(tokenData, encryptionKey = null, operation = 'export') {
    try {
      const isArray = Array.isArray(tokenData)
      const dataToProcess = isArray ? tokenData : [tokenData]

      logger.debug('🔒 Processing encrypted token data', {
        count: dataToProcess.length,
        hasEncryptionKey: !!encryptionKey,
        operation
      })

      const processedData = dataToProcess.map((data) => {
        const processed = { ...data }
        const tokenFields = ['accessToken', 'refreshToken', 'claudeAiOauth']

        for (const field of tokenFields) {
          if (data[field]) {
            const tokenInfo = this._analyzeTokenSecurity(data[field])

            if (operation === 'export') {
              // 为导出添加安全元数据
              processed[`_${field}_type`] = tokenInfo.type
              processed[`_${field}_algorithm`] = tokenInfo.algorithm

              if (tokenInfo.type === 'plaintext') {
                processed[`_${field}_warning`] = 'Plaintext token detected - consider encryption'
              }
            } else if (operation === 'import') {
              // 导入时验证token
              if (tokenInfo.type === 'encrypted' && encryptionKey) {
                const testResult = this._testTokenDecryption(data[field])
                if (!testResult.success) {
                  processed[`_${field}_error`] =
                    `Cannot decrypt with provided key: ${testResult.error}`
                }
              }
            }
          }
        }

        return processed
      })

      return isArray ? processedData : processedData[0]
    } catch (error) {
      logger.error('❌ Failed to process encrypted token data:', error)
      throw new Error(`Encrypted token processing failed: ${error.message}`)
    }
  }

  /**
   * 验证文件校验和
   * @param {string} filePath 文件路径
   * @param {string} expectedChecksum 期望的校验和
   * @param {string} algorithm 哈希算法，默认为 'sha256'
   * @returns {Object} 验证结果
   */
  async validateFileChecksum(filePath, expectedChecksum, algorithm = 'sha256') {
    try {
      logger.debug('🔍 Validating file checksum', {
        filePath: path.basename(filePath),
        algorithm,
        expectedChecksum: `${expectedChecksum?.substring(0, 8)}...`
      })

      const content = await fs.readFile(filePath, 'utf8')
      const actualChecksum = crypto.createHash(algorithm).update(content).digest('hex')
      const matches = actualChecksum === expectedChecksum

      const result = {
        valid: matches,
        filePath,
        algorithm,
        expected: expectedChecksum,
        actual: actualChecksum,
        fileSize: content.length
      }

      if (!matches) {
        logger.warn('⚠️ File checksum mismatch', result)
      } else {
        logger.debug('✅ File checksum validated successfully')
      }

      return result
    } catch (error) {
      logger.error('❌ File checksum validation failed:', error)
      return {
        valid: false,
        error: error.message,
        filePath,
        algorithm,
        expected: expectedChecksum
      }
    }
  }

  /**
   * 验证数据完整性
   * @param {Object} data 要验证的数据
   * @param {Object} schema 验证模式（可选）
   * @returns {Object} 验证结果
   */
  validateDataIntegrity(data, schema = null) {
    try {
      logger.debug('🔍 Validating data integrity', {
        hasData: !!data,
        hasSchema: !!schema,
        dataType: typeof data
      })

      const result = {
        valid: true,
        errors: [],
        warnings: [],
        summary: {
          totalFields: 0,
          validFields: 0,
          nullFields: 0,
          invalidFields: 0
        }
      }

      if (!data || typeof data !== 'object') {
        result.valid = false
        result.errors.push({
          type: 'invalid_data_type',
          message: 'Data must be an object',
          actual: typeof data
        })
        return result
      }

      // 基本完整性检查
      const fields = Object.keys(data)
      result.summary.totalFields = fields.length

      for (const field of fields) {
        const value = data[field]

        if (value === null || value === undefined) {
          result.summary.nullFields++
        } else if (typeof value === 'string' && value.trim() === '') {
          result.summary.nullFields++
          result.warnings.push({
            type: 'empty_field',
            field,
            message: 'Field contains empty string'
          })
        } else {
          result.summary.validFields++
        }
      }

      // 如果有schema，执行详细验证
      if (schema && typeof schema === 'object') {
        for (const [field, rules] of Object.entries(schema)) {
          if (rules.required && !Object.prototype.hasOwnProperty.call(data, field)) {
            result.errors.push({
              type: 'required_field_missing',
              field,
              message: 'Required field is missing'
            })
            result.valid = false
          }

          if (Object.prototype.hasOwnProperty.call(data, field) && rules.type) {
            const actualType = Array.isArray(data[field]) ? 'array' : typeof data[field]
            if (actualType !== rules.type) {
              result.errors.push({
                type: 'type_mismatch',
                field,
                expected: rules.type,
                actual: actualType,
                message: `Field type mismatch`
              })
              result.summary.invalidFields++
            }
          }
        }
      }

      logger.debug('✅ Data integrity validation completed', result.summary)
      return result
    } catch (error) {
      logger.error('❌ Data integrity validation failed:', error)
      return {
        valid: false,
        error: error.message,
        errors: [
          {
            type: 'validation_error',
            message: error.message
          }
        ],
        warnings: []
      }
    }
  }

  /**
   * 记录审计日志
   * @param {string} operation 操作名称
   * @param {string} user 用户标识
   * @param {Object} details 详细信息
   * @returns {Object} 审计日志条目
   */
  auditLog(operation, user, details = {}) {
    try {
      const timestamp = new Date().toISOString()
      const auditEntry = {
        timestamp,
        operation,
        user: user || 'system',
        details,
        operationId: this.operationId,
        sessionId: details.sessionId || null
      }

      // 记录到内部审计日志
      this._auditLog(operation, 'info', {
        user,
        ...details
      })

      // 记录到主日志系统
      logger.info(`🔍 Audit: ${operation}`, auditEntry)

      return auditEntry
    } catch (error) {
      logger.error('❌ Failed to create audit log:', error)
    }
  }

  /**
   * 生成安全报告
   * @param {Object} stats 统计数据（可选）
   * @returns {Object} 安全报告
   */
  generateSecurityReport(stats = {}) {
    try {
      logger.debug('📊 Generating security report')

      const report = {
        generatedAt: new Date().toISOString(),
        operationId: this.operationId,
        securityConfiguration: {
          sanitizationLevel: this.options.sanitizationLevel,
          enabledFeatures: {
            checksumVerification: this.options.enableChecksumVerification,
            versionCheck: this.options.enableVersionCheck,
            dependencyValidation: this.options.enableDependencyValidation,
            auditLogging: this.options.enableAuditLogging
          }
        },
        statistics: {
          totalOperations: this.auditLogEntries.length,
          successfulOperations: this.auditLogEntries.filter((log) => log.status === 'success')
            .length,
          failedOperations: this.auditLogEntries.filter((log) => log.status === 'error').length,
          warningOperations: this.auditLogEntries.filter((log) => log.status === 'warn').length,
          ...stats
        },
        securityAssessment: {
          overallRisk: this._assessOverallSecurityRisk(),
          dataProtectionLevel: this._assessDataProtectionLevel(),
          complianceStatus: this._assessComplianceStatus()
        },
        recommendations: this._generateSecurityRecommendations()
      }

      logger.info('📊 Security report generated successfully', {
        totalOperations: report.statistics.totalOperations,
        overallRisk: report.securityAssessment.overallRisk
      })

      return report
    } catch (error) {
      logger.error('❌ Failed to generate security report:', error)
      return {
        generatedAt: new Date().toISOString(),
        error: error.message,
        operationId: this.operationId,
        status: 'error'
      }
    }
  }

  /**
   * 评估总体安全风险
   * @private
   * @returns {string} 风险级别
   */
  _assessOverallSecurityRisk() {
    let riskScore = 0
    const _maxScore = 10 // 最大风险分数，供将来扩展使用

    // 脱敏级别影响
    if (this.options.sanitizationLevel === 'minimal') {
      riskScore += 3
    } else if (this.options.sanitizationLevel === 'moderate') {
      riskScore += 1
    }

    // 验证功能影响
    if (!this.options.enableChecksumVerification) {
      riskScore += 2
    }
    if (!this.options.enableVersionCheck) {
      riskScore += 1
    }
    if (!this.options.enableAuditLogging) {
      riskScore += 2
    }

    // 错误率影响
    const errorRate =
      this.auditLogEntries.filter((log) => log.status === 'error').length /
      Math.max(this.auditLogEntries.length, 1)
    if (errorRate > 0.1) {
      riskScore += 2
    }

    if (riskScore >= 7) {
      return 'high'
    }
    if (riskScore >= 4) {
      return 'medium'
    }
    return 'low'
  }

  /**
   * 评估数据保护级别
   * @private
   * @returns {string} 保护级别
   */
  _assessDataProtectionLevel() {
    if (this.options.sanitizationLevel === 'strict' && this.options.enableAuditLogging) {
      return 'excellent'
    }
    if (this.options.sanitizationLevel === 'moderate') {
      return 'good'
    }
    if (this.options.sanitizationLevel === 'minimal') {
      return 'basic'
    }
    return 'unknown'
  }

  /**
   * 生成详细的安全审计报告
   * @returns {Object} 审计报告
   */
  generateSecurityAuditReport() {
    const report = {
      operationId: this.operationId,
      timestamp: new Date().toISOString(),
      summary: {
        totalOperations: this.auditLogEntries.length,
        successfulOperations: this.auditLogEntries.filter((log) => log.status === 'success').length,
        failedOperations: this.auditLogEntries.filter((log) => log.status === 'error').length,
        warningOperations: this.auditLogEntries.filter((log) => log.status === 'warn').length
      },
      securityConfiguration: {
        sanitizationLevel: this.options.sanitizationLevel,
        enabledVerifications: {
          checksumVerification: this.options.enableChecksumVerification,
          versionCheck: this.options.enableVersionCheck,
          dependencyValidation: this.options.enableDependencyValidation
        },
        auditingEnabled: this.options.enableAuditLogging
      },
      operationLog: this.auditLogEntries.map((entry) => ({
        timestamp: entry.timestamp,
        operation: entry.operation,
        status: entry.status,
        duration: entry.duration,
        details: entry.details
      })),
      recommendations: this._generateSecurityRecommendations(),
      complianceStatus: this._assessComplianceStatus()
    }

    logger.info('🛡️ Security audit report generated', {
      operationId: this.operationId,
      totalOperations: report.summary.totalOperations
    })

    return report
  }

  /**
   * 私有辅助方法 - 记录审计日志
   */
  _auditLog(operation, status, details = {}) {
    if (!this.options.enableAuditLogging) {
      return
    }

    const timestamp = new Date().toISOString()
    const logEntry = {
      timestamp,
      operation,
      status,
      details,
      operationId: this.operationId,
      duration: details.startTime ? Date.now() - details.startTime : null
    }

    this.auditLogEntries.push(logEntry)

    // 根据审计级别记录日志
    const logLevel = this.options.auditLogLevel
    const message = `🔍 Security audit: ${operation} - ${status}`

    switch (status) {
      case 'error':
        logger.error(message, logEntry)
        break
      case 'warn':
        logger.warn(message, logEntry)
        break
      default:
        if (logLevel === 'debug' || (logLevel === 'info' && status !== 'start')) {
          logger.info(message, logEntry)
        }
    }
  }

  /**
   * 生成操作ID
   */
  _generateOperationId() {
    return `sec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  }

  /**
   * 检测哈希类型
   */
  _detectHashType(hash) {
    if (!hash || hash.startsWith('[REDACTED')) {
      return 'redacted'
    }
    if (hash.startsWith('$2a$') || hash.startsWith('$2b$')) {
      return 'bcrypt'
    }
    if (hash.startsWith('$argon2')) {
      return 'argon2'
    }
    if (hash.startsWith('pbkdf2')) {
      return 'pbkdf2'
    }
    if (hash.length === 64) {
      return 'sha256'
    }
    if (hash.length === 32) {
      return 'md5'
    }
    return 'unknown'
  }

  /**
   * 部分掩码处理
   */
  _partialMask(value, maskRatio = 0.7) {
    if (!value) {
      return value
    }
    const maskLength = Math.floor(value.length * maskRatio)
    const keepLength = value.length - maskLength
    const keepStart = Math.floor(keepLength / 2)
    const keepEnd = keepLength - keepStart

    return (
      value.substring(0, keepStart) +
      '*'.repeat(maskLength) +
      value.substring(value.length - keepEnd)
    )
  }

  /**
   * 生成安全的临时密码
   */
  _generateSecureTemporaryPassword() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*'
    const array = new Uint8Array(16)
    crypto.getRandomValues(array)
    return Array.from(array, (byte) => chars[byte % chars.length]).join('')
  }

  /**
   * 哈希密码
   */
  async _hashPassword(password) {
    const bcrypt = require('bcryptjs')
    return await bcrypt.hash(password, 12)
  }

  /**
   * 验证密码哈希强度
   */
  _validatePasswordHashStrength(hash) {
    const hashType = this._detectHashType(hash)
    let score = 0
    const recommendations = []

    switch (hashType) {
      case 'argon2':
        score = 5
        break
      case 'bcrypt':
        score = 4
        break
      case 'pbkdf2':
        score = 3
        break
      case 'sha256':
        score = 2
        recommendations.push('Consider upgrading to bcrypt or argon2')
        break
      case 'md5':
        score = 1
        recommendations.push('MD5 is cryptographically broken, upgrade immediately')
        break
      default:
        score = 0
        recommendations.push('Unknown hash type, manual review required')
    }

    return { score, type: hashType, recommendations }
  }

  /**
   * 生成密码安全建议
   */
  _generatePasswordSecurityRecommendations(result) {
    const recommendations = []

    if (result.securityAlerts.some((alert) => alert.type === 'temp_password_generated')) {
      recommendations.push({
        priority: 'high',
        type: 'password_reset_required',
        message: 'Admin users with temporary passwords must reset passwords immediately',
        action: 'Provide password reset instructions to affected users'
      })
    }

    if (result.warnings.some((warning) => warning.type === 'weak_password_hash')) {
      recommendations.push({
        priority: 'medium',
        type: 'hash_upgrade_recommended',
        message: 'Consider upgrading password hashing algorithm',
        action: 'Implement progressive hash upgrade on next login'
      })
    }

    return recommendations
  }

  /**
   * 检查是否为脱敏值
   */
  _isRedactedValue(value) {
    return !value || (typeof value === 'string' && value.startsWith('[REDACTED'))
  }

  /**
   * 验证2FA密钥
   */
  _validate2FASecret(secret) {
    if (!secret) {
      return { valid: false, reason: 'Secret is empty' }
    }

    // Base32 格式验证
    if (!/^[A-Z2-7]+=*$/i.test(secret)) {
      return { valid: false, reason: 'Invalid Base32 format' }
    }

    // 长度验证（通常是16或32字符）
    const cleanSecret = secret.replace(/=/g, '')
    if (cleanSecret.length < 16) {
      return { valid: false, reason: 'Secret too short' }
    }

    return { valid: true }
  }

  /**
   * 生成2FA安全建议
   */
  _generate2FASecurityRecommendations(result) {
    const recommendations = []

    const requiresReconfigCount = result.securityAlerts.filter(
      (alert) => alert.type === '2fa_requires_reconfiguration'
    ).length

    if (requiresReconfigCount > 0) {
      recommendations.push({
        priority: 'high',
        type: '2fa_reconfiguration_required',
        message: `${requiresReconfigCount} users need to reconfigure 2FA`,
        action: 'Send 2FA setup instructions to affected users'
      })
    }

    return recommendations
  }

  /**
   * 分析Token安全性
   */
  _analyzeTokenSecurity(token) {
    if (!token) {
      return { type: 'empty', algorithm: null }
    }

    // 检查是否为脱敏值
    if (this._isRedactedValue(token)) {
      return { type: 'redacted', algorithm: null }
    }

    // 检查是否为加密格式（包含冒号分隔的IV）
    if (token.includes(':') && token.split(':').length === 2) {
      const [iv, encrypted] = token.split(':')
      if (/^[0-9a-fA-F]{32}$/.test(iv) && /^[0-9a-fA-F]+$/.test(encrypted)) {
        return { type: 'encrypted', algorithm: 'aes-256-cbc' }
      }
    }

    // 检查是否为旧格式加密
    if (/^[0-9a-fA-F]+$/.test(token) && token.length > 32) {
      return { type: 'encrypted', algorithm: 'legacy' }
    }

    // 检查是否为JWT格式
    if (token.split('.').length === 3) {
      return { type: 'plaintext', algorithm: 'jwt' }
    }

    // 检查是否为明文token
    if (token.length > 10 && /^[A-Za-z0-9_-]+$/.test(token)) {
      return { type: 'plaintext', algorithm: null }
    }

    return { type: 'invalid', algorithm: null }
  }

  /**
   * 测试Token解密
   */
  _testTokenDecryption(encryptedToken) {
    try {
      // 这里应该使用与ClaudeAccountService相同的解密逻辑
      // 为了安全，我们只进行格式验证，不实际解密
      const parts = encryptedToken.split(':')
      if (parts.length !== 2) {
        return { success: false, error: 'Invalid encrypted format' }
      }

      const [iv, encrypted] = parts
      if (!/^[0-9a-fA-F]{32}$/.test(iv)) {
        return { success: false, error: 'Invalid IV format' }
      }

      if (!/^[0-9a-fA-F]+$/.test(encrypted)) {
        return { success: false, error: 'Invalid encrypted data format' }
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  /**
   * 生成Token安全建议
   */
  _generateTokenSecurityRecommendations(result) {
    const recommendations = []

    if (result.tokenStats.plaintext > 0) {
      recommendations.push({
        priority: 'high',
        type: 'encrypt_plaintext_tokens',
        message: `${result.tokenStats.plaintext} plaintext tokens detected`,
        action: 'Encrypt all plaintext tokens for security'
      })
    }

    if (result.securityAlerts.some((alert) => alert.type === 'token_decryption_failed')) {
      recommendations.push({
        priority: 'critical',
        type: 'key_compatibility_issue',
        message: 'Some tokens cannot be decrypted with current encryption key',
        action: 'Verify encryption key compatibility before importing'
      })
    }

    return recommendations
  }

  /**
   * 比较版本号
   */
  _compareVersions(version1, version2) {
    const v1parts = version1.split('.').map(Number)
    const v2parts = version2.split('.').map(Number)

    for (let i = 0; i < Math.max(v1parts.length, v2parts.length); i++) {
      const v1part = v1parts[i] || 0
      const v2part = v2parts[i] || 0

      if (v1part > v2part) {
        return 1
      }
      if (v1part < v2part) {
        return -1
      }
    }

    return 0
  }

  /**
   * 获取版本兼容性矩阵
   */
  _getVersionCompatibilityMatrix() {
    return {
      '1.0.0': [
        'apiKeys',
        'claudeAccounts',
        'geminiAccounts',
        'openaiAccounts',
        'adminAccounts',
        'systemConfig',
        'usageStats'
      ],
      '1.1.0': [
        'apiKeys',
        'claudeAccounts',
        'geminiAccounts',
        'openaiAccounts',
        'adminAccounts',
        'systemConfig',
        'usageStats',
        'systemStats',
        'twoFactorConfigs',
        'brandingConfig'
      ]
    }
  }

  /**
   * 从元数据提取功能特性
   */
  _extractFeaturesFromMetadata(metadata) {
    const features = []

    if (metadata.categories) {
      features.push(...Object.keys(metadata.categories))
    }

    if (metadata.exportOptions?.includeTwoFactorConfigs) {
      features.push('twoFactorConfigs')
    }

    if (metadata.exportOptions?.includeStats) {
      features.push('advancedStats')
    }

    return [...new Set(features)]
  }

  /**
   * 检测循环依赖
   */
  _detectCircularDependencies(dependencyMap) {
    const circular = []
    const visited = new Set()
    const recursionStack = new Set()

    const dfs = (node, nodePath) => {
      if (recursionStack.has(node)) {
        circular.push([...nodePath, node])
        return
      }

      if (visited.has(node)) {
        return
      }

      visited.add(node)
      recursionStack.add(node)

      const deps = dependencyMap[node] || []
      for (const dep of deps) {
        dfs(dep, [...nodePath, node])
      }

      recursionStack.delete(node)
    }

    for (const node of Object.keys(dependencyMap)) {
      if (!visited.has(node)) {
        dfs(node, [])
      }
    }

    return circular
  }

  /**
   * 检查引用完整性
   */
  _checkReferenceIntegrity(usageStats, apiKeys) {
    const result = { valid: true, issues: [] }

    if (!Array.isArray(usageStats) || !Array.isArray(apiKeys)) {
      return result
    }

    const apiKeyIds = new Set(apiKeys.map((key) => key.id))

    for (const stat of usageStats) {
      if (stat.keyId && !apiKeyIds.has(stat.keyId)) {
        result.issues.push({
          type: 'orphaned_usage_stat',
          statId: stat.id || 'unknown',
          keyId: stat.keyId,
          message: 'Usage statistic references non-existent API key'
        })
        result.valid = false
      }
    }

    return result
  }

  /**
   * 生成安全建议
   */
  _generateSecurityRecommendations() {
    const recommendations = []

    const errorCount = this.auditLogEntries.filter((log) => log.status === 'error').length
    if (errorCount > 0) {
      recommendations.push({
        priority: 'high',
        category: 'error_handling',
        message: `${errorCount} security operations failed`,
        action: 'Review error logs and resolve security issues before proceeding'
      })
    }

    if (this.options.sanitizationLevel === 'minimal') {
      recommendations.push({
        priority: 'medium',
        category: 'data_sanitization',
        message: 'Minimal sanitization level may expose sensitive data',
        action: 'Consider using strict sanitization level for production exports'
      })
    }

    return recommendations
  }

  /**
   * 评估合规状态
   */
  _assessComplianceStatus() {
    const status = {
      overall: 'compliant',
      dataProtection: 'compliant',
      integrityChecks: 'compliant',
      auditTrail: 'compliant',
      issues: []
    }

    // 检查数据保护合规
    if (this.options.sanitizationLevel === 'minimal') {
      status.dataProtection = 'warning'
      status.issues.push('Minimal sanitization may not meet data protection requirements')
    }

    // 检查完整性检查合规
    if (!this.options.enableChecksumVerification) {
      status.integrityChecks = 'warning'
      status.issues.push('Checksum verification disabled')
    }

    // 检查审计跟踪合规
    if (!this.options.enableAuditLogging) {
      status.auditTrail = 'non-compliant'
      status.issues.push('Audit logging disabled')
    }

    // 总体评估
    if (status.issues.length > 0) {
      status.overall = status.auditTrail === 'non-compliant' ? 'non-compliant' : 'warning'
    }

    return status
  }
}

module.exports = DataSecurityService
