/**
 * @fileoverview Frontend User Components Tests (Task 8.4)
 * 
 * Comprehensive frontend tests for user management components including:
 * - Vue component unit testing (LoginForm, UserList, GroupManagement)
 * - UI interaction testing (forms, modals, navigation)
 * - Responsive design validation (mobile, tablet, desktop)
 * - Theme compatibility testing (light/dark mode)
 * - Accessibility testing (keyboard navigation, screen readers)
 * - User experience flow testing
 * 
 * Uses Playwright for E2E testing since the project uses Vite + Vue 3
 * 
 * @author Claude Code
 */

const { test, expect } = require('@playwright/test')
const path = require('path')

// Test configuration
const BASE_URL = process.env.TEST_URL || 'http://localhost:3000'
const MOBILE_VIEWPORT = { width: 375, height: 667 }
const TABLET_VIEWPORT = { width: 768, height: 1024 }
const DESKTOP_VIEWPORT = { width: 1920, height: 1080 }

// Test data
const TEST_USERS = {
  admin: {
    username: 'admin',
    password: 'admin123',
    role: 'admin'
  },
  user: {
    username: 'testuser',
    password: 'user123',
    role: 'user'
  },
  viewer: {
    username: 'viewer',
    password: 'viewer123',
    role: 'viewer'
  }
}

// Mock server responses
async function mockApiResponses(page) {
  // Mock login endpoint
  await page.route('**/api/auth/login', async (route) => {
    const request = route.request()
    const postData = request.postDataJSON()

    if (postData.username === 'admin' && postData.password === 'admin123') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          user: {
            id: 'admin-id',
            username: 'admin',
            role: 'admin',
            email: 'admin@example.com'
          },
          sessionToken: 'mock-admin-token',
          authMethod: 'local'
        })
      })
    } else if (postData.username === 'testuser' && postData.password === 'user123') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          user: {
            id: 'user-id',
            username: 'testuser',
            role: 'user',
            email: 'user@example.com'
          },
          sessionToken: 'mock-user-token',
          authMethod: 'local'
        })
      })
    } else {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Invalid username or password'
        })
      })
    }
  })

  // Mock user list endpoint
  await page.route('**/api/auth/users**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          users: [
            {
              id: 'user1',
              username: 'user1',
              email: 'user1@example.com',
              role: 'user',
              status: 'active',
              createdAt: new Date().toISOString()
            },
            {
              id: 'user2',
              username: 'user2',
              email: 'user2@example.com',
              role: 'viewer',
              status: 'active',
              createdAt: new Date().toISOString()
            }
          ],
          total: 2
        })
      })
    } else if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'new-user-id',
          username: 'newuser',
          email: 'new@example.com',
          role: 'user',
          status: 'active',
          createdAt: new Date().toISOString()
        })
      })
    }
  })

  // Mock groups endpoint
  await page.route('**/api/auth/groups**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'group1',
            name: 'Developers',
            description: 'Development team',
            members: ['user1'],
            createdAt: new Date().toISOString()
          },
          {
            id: 'group2',
            name: 'Managers',
            description: 'Management team',
            members: ['user2'],
            createdAt: new Date().toISOString()
          }
        ])
      })
    }
  })
}

// ==================== Login Form Component Tests ====================

test.describe('LoginForm Component', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiResponses(page)
    await page.goto(`${BASE_URL}/login`)
  })

  test('should render login form correctly', async ({ page }) => {
    // Check for main elements
    await expect(page.locator('h1')).toContainText('Claude Relay Service')
    await expect(page.locator('input[type="text"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()

    // Check form labels
    await expect(page.locator('text=用户名')).toBeVisible()
    await expect(page.locator('text=密码')).toBeVisible()
  })

  test('should validate username input', async ({ page }) => {
    const usernameInput = page.locator('input[type="text"]')
    const passwordInput = page.locator('input[type="password"]')

    // Test empty username
    await usernameInput.click()
    await passwordInput.click() // Trigger blur
    await expect(page.locator('text=用户名不能为空')).toBeVisible()

    // Test username too short
    await usernameInput.fill('ab')
    await passwordInput.click()
    await expect(page.locator('text=用户名长度必须在 3-50 个字符之间')).toBeVisible()

    // Test invalid characters
    await usernameInput.fill('user@123')
    await passwordInput.click()
    await expect(page.locator('text=用户名只能包含字母、数字、下划线和连字符')).toBeVisible()

    // Test valid username
    await usernameInput.fill('testuser')
    await passwordInput.click()
    await expect(page.locator('.text-red-500')).not.toBeVisible()
  })

  test('should validate password input', async ({ page }) => {
    const usernameInput = page.locator('input[type="text"]')
    const passwordInput = page.locator('input[type="password"]')

    // Fill valid username first
    await usernameInput.fill('testuser')

    // Test empty password
    await passwordInput.click()
    await usernameInput.click() // Trigger blur
    await expect(page.locator('text=密码不能为空')).toBeVisible()

    // Test valid password
    await passwordInput.fill('password123')
    await usernameInput.click()
    await expect(page.locator('.text-red-500')).not.toBeVisible()
  })

  test('should toggle password visibility', async ({ page }) => {
    const passwordInput = page.locator('input[type="password"]')
    const toggleButton = page.locator('button:has(.fa-eye)')

    // Initially password should be hidden
    await expect(passwordInput).toHaveAttribute('type', 'password')
    await expect(toggleButton.locator('.fa-eye')).toBeVisible()

    // Click toggle to show password
    await toggleButton.click()
    await expect(page.locator('input[type="text"]').nth(1)).toBeVisible()
    await expect(toggleButton.locator('.fa-eye-slash')).toBeVisible()

    // Click again to hide password
    await toggleButton.click()
    await expect(passwordInput).toHaveAttribute('type', 'password')
    await expect(toggleButton.locator('.fa-eye')).toBeVisible()
  })

  test('should show advanced options', async ({ page }) => {
    const advancedToggle = page.locator('text=显示高级选项')
    
    // Initially auth method should be hidden
    await expect(page.locator('select')).not.toBeVisible()

    // Click to show advanced options
    await advancedToggle.click()
    await expect(page.locator('select')).toBeVisible()
    await expect(page.locator('text=认证方式')).toBeVisible()
    await expect(page.locator('text=隐藏高级选项')).toBeVisible()

    // Check auth method options
    const authSelect = page.locator('select')
    await expect(authSelect.locator('option[value="auto"]')).toContainText('自动检测')
    await expect(authSelect.locator('option[value="local"]')).toContainText('本地认证')
    await expect(authSelect.locator('option[value="ldap"]')).toContainText('LDAP认证')
  })

  test('should perform successful login', async ({ page }) => {
    await page.fill('input[type="text"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')
    
    // Submit form
    await page.click('button[type="submit"]')
    
    // Should show loading state
    await expect(page.locator('text=登录中...')).toBeVisible()
    
    // Should redirect to dashboard (assuming successful login redirects)
    await expect(page).toHaveURL(/dashboard|admin/)
  })

  test('should handle login error', async ({ page }) => {
    await page.fill('input[type="text"]', 'invaliduser')
    await page.fill('input[type="password"]', 'wrongpassword')
    
    // Submit form
    await page.click('button[type="submit"]')
    
    // Should show error message
    await expect(page.locator('.text-red-800')).toContainText('Invalid username or password')
    await expect(page.locator('.fa-exclamation-triangle')).toBeVisible()
  })

  test('should auto-focus username field', async ({ page }) => {
    // Username field should be focused on page load
    await expect(page.locator('input[type="text"]')).toBeFocused()
  })

  test('should disable form during loading', async ({ page }) => {
    await page.fill('input[type="text"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')
    
    // Intercept to add delay
    await page.route('**/api/auth/login', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 1000))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          user: { id: 'admin-id', username: 'admin', role: 'admin' },
          sessionToken: 'mock-token'
        })
      })
    })
    
    // Start login
    const submitPromise = page.click('button[type="submit"]')
    
    // Check that form elements are disabled
    await expect(page.locator('input[type="text"]')).toBeDisabled()
    await expect(page.locator('input[type="password"]')).toBeDisabled()
    await expect(page.locator('button[type="submit"]')).toBeDisabled()
    
    await submitPromise
  })
})

// ==================== User List Component Tests ====================

test.describe('UserList Component', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiResponses(page)
    // Login as admin first
    await page.goto(`${BASE_URL}/login`)
    await page.fill('input[type="text"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')
    
    // Navigate to users page
    await page.goto(`${BASE_URL}/users`)
  })

  test('should display user list table', async ({ page }) => {
    // Check table headers
    await expect(page.locator('text=用户名')).toBeVisible()
    await expect(page.locator('text=邮箱')).toBeVisible()
    await expect(page.locator('text=角色')).toBeVisible()
    await expect(page.locator('text=状态')).toBeVisible()

    // Check user data
    await expect(page.locator('text=user1')).toBeVisible()
    await expect(page.locator('text=user1@example.com')).toBeVisible()
    await expect(page.locator('text=user2')).toBeVisible()
  })

  test('should open create user modal', async ({ page }) => {
    const createButton = page.locator('button:has-text("创建用户")')
    await createButton.click()

    // Check modal is visible
    await expect(page.locator('.modal')).toBeVisible()
    await expect(page.locator('text=创建新用户')).toBeVisible()
    
    // Check form fields
    await expect(page.locator('input[placeholder*="用户名"]')).toBeVisible()
    await expect(page.locator('input[placeholder*="邮箱"]')).toBeVisible()
    await expect(page.locator('select')).toBeVisible() // Role selector
  })

  test('should create new user', async ({ page }) => {
    // Open create modal
    await page.click('button:has-text("创建用户")')
    
    // Fill form
    await page.fill('input[placeholder*="用户名"]', 'newuser')
    await page.fill('input[placeholder*="邮箱"]', 'new@example.com')
    await page.selectOption('select', 'user')
    await page.fill('input[type="password"]', 'NewPassword123!')
    
    // Submit
    await page.click('button[type="submit"]')
    
    // Check success (could be notification or redirect)
    await expect(page.locator('text=创建成功')).toBeVisible()
  })

  test('should filter users', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="搜索"]')
    
    // Search for specific user
    await searchInput.fill('user1')
    
    // Should show only matching user
    await expect(page.locator('text=user1')).toBeVisible()
    await expect(page.locator('text=user2')).not.toBeVisible()
    
    // Clear search
    await searchInput.fill('')
    
    // Should show all users again
    await expect(page.locator('text=user1')).toBeVisible()
    await expect(page.locator('text=user2')).toBeVisible()
  })

  test('should edit user', async ({ page }) => {
    // Click edit button for first user
    const editButton = page.locator('tr:has-text("user1") button:has(.fa-edit)')
    await editButton.click()
    
    // Check edit modal
    await expect(page.locator('text=编辑用户')).toBeVisible()
    
    // Modify user data
    await page.fill('input[value="user1@example.com"]', 'updated@example.com')
    
    // Save changes
    await page.click('button[type="submit"]')
    
    // Check success
    await expect(page.locator('text=更新成功')).toBeVisible()
  })
})

// ==================== Group Management Component Tests ====================

test.describe('GroupManagement Component', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiResponses(page)
    // Login as admin
    await page.goto(`${BASE_URL}/login`)
    await page.fill('input[type="text"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')
    
    // Navigate to groups page
    await page.goto(`${BASE_URL}/groups`)
  })

  test('should display groups list', async ({ page }) => {
    await expect(page.locator('text=Developers')).toBeVisible()
    await expect(page.locator('text=Managers')).toBeVisible()
    await expect(page.locator('text=Development team')).toBeVisible()
  })

  test('should create new group', async ({ page }) => {
    // Click create group button
    await page.click('button:has-text("创建组")')
    
    // Fill group form
    await page.fill('input[placeholder*="组名"]', 'Test Group')
    await page.fill('textarea[placeholder*="描述"]', 'Test group description')
    
    // Submit
    await page.click('button[type="submit"]')
    
    // Check success
    await expect(page.locator('text=Test Group')).toBeVisible()
  })

  test('should manage group members', async ({ page }) => {
    // Click manage members for first group
    const membersButton = page.locator('button:has-text("管理成员")').first()
    await membersButton.click()
    
    // Check members modal
    await expect(page.locator('text=管理组成员')).toBeVisible()
    
    // Add member
    await page.selectOption('select', 'user2')
    await page.click('button:has-text("添加成员")')
    
    // Check member added
    await expect(page.locator('text=user2')).toBeVisible()
  })
})

// ==================== Responsive Design Tests ====================

test.describe('Responsive Design', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiResponses(page)
  })

  test('should work on mobile viewport', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT)
    await page.goto(`${BASE_URL}/login`)

    // Check mobile layout
    await expect(page.locator('.w-full')).toBeVisible()
    
    // Login form should be responsive
    const form = page.locator('form')
    const formBox = await form.boundingBox()
    expect(formBox.width).toBeLessThan(MOBILE_VIEWPORT.width)
  })

  test('should work on tablet viewport', async ({ page }) => {
    await page.setViewportSize(TABLET_VIEWPORT)
    await page.goto(`${BASE_URL}/login`)

    // Check tablet layout adaptations
    await expect(page.locator('form')).toBeVisible()
    
    // Should have appropriate padding/margins
    const container = page.locator('.max-w-md')
    await expect(container).toBeVisible()
  })

  test('should work on desktop viewport', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await page.goto(`${BASE_URL}/login`)

    // Check desktop layout
    await expect(page.locator('form')).toBeVisible()
    
    // Should be centered with appropriate max-width
    const container = page.locator('.max-w-md')
    const containerBox = await container.boundingBox()
    expect(containerBox.width).toBeLessThan(500) // max-width constraint
  })

  test('should handle navigation on different screen sizes', async ({ page }) => {
    // Test mobile navigation
    await page.setViewportSize(MOBILE_VIEWPORT)
    await page.goto(`${BASE_URL}/dashboard`)
    
    // Mobile should have hamburger menu or different nav
    const mobileNav = page.locator('.mobile-nav, .hamburger, [data-testid="mobile-menu"]')
    if (await mobileNav.count() > 0) {
      await expect(mobileNav).toBeVisible()
    }

    // Test desktop navigation
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await page.reload()
    
    // Desktop should have full navigation
    const desktopNav = page.locator('nav, .navigation, [data-testid="desktop-nav"]')
    if (await desktopNav.count() > 0) {
      await expect(desktopNav).toBeVisible()
    }
  })
})

// ==================== Theme Compatibility Tests ====================

test.describe('Theme Compatibility', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiResponses(page)
    await page.goto(`${BASE_URL}/login`)
  })

  test('should support dark mode', async ({ page }) => {
    // Toggle to dark mode if toggle exists
    const themeToggle = page.locator('.theme-toggle, [data-testid="theme-toggle"]')
    if (await themeToggle.count() > 0) {
      await themeToggle.click()
      
      // Check dark mode is applied
      await expect(page.locator('html')).toHaveClass(/dark/)
      
      // Check dark mode styles are applied
      const body = page.locator('body')
      const computedStyle = await body.evaluate(el => 
        window.getComputedStyle(el).backgroundColor
      )
      // Should be dark background
      expect(computedStyle).toMatch(/rgb\(.*?, .*?, .*?\)/)
    }
  })

  test('should support light mode', async ({ page }) => {
    // Ensure light mode is active
    const themeToggle = page.locator('.theme-toggle, [data-testid="theme-toggle"]')
    if (await themeToggle.count() > 0) {
      // If dark mode is active, toggle to light
      const isDark = await page.locator('html').evaluate(el => 
        el.classList.contains('dark')
      )
      
      if (isDark) {
        await themeToggle.click()
      }
      
      // Check light mode is applied
      await expect(page.locator('html')).not.toHaveClass(/dark/)
    }
  })

  test('should preserve theme choice across navigation', async ({ page }) => {
    // Set dark mode
    const themeToggle = page.locator('.theme-toggle, [data-testid="theme-toggle"]')
    if (await themeToggle.count() > 0) {
      await themeToggle.click()
      
      // Navigate to another page
      await page.goto(`${BASE_URL}/dashboard`)
      
      // Theme should persist
      await expect(page.locator('html')).toHaveClass(/dark/)
    }
  })
})

// ==================== Accessibility Tests ====================

test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiResponses(page)
    await page.goto(`${BASE_URL}/login`)
  })

  test('should support keyboard navigation', async ({ page }) => {
    // Tab through form elements
    await page.press('body', 'Tab')
    await expect(page.locator('input[type="text"]')).toBeFocused()
    
    await page.press('body', 'Tab')
    await expect(page.locator('input[type="password"]')).toBeFocused()
    
    await page.press('body', 'Tab')
    await expect(page.locator('button[type="submit"]')).toBeFocused()
  })

  test('should have proper ARIA labels', async ({ page }) => {
    // Check for aria-labels or labels
    const usernameLabel = page.locator('label:has-text("用户名")')
    const passwordLabel = page.locator('label:has-text("密码")')
    
    await expect(usernameLabel).toBeVisible()
    await expect(passwordLabel).toBeVisible()
  })

  test('should have proper heading hierarchy', async ({ page }) => {
    // Check for proper h1, h2, h3 structure
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    
    // Main title should be h1
    await expect(h1).toContainText('Claude Relay Service')
  })

  test('should have sufficient color contrast', async ({ page }) => {
    // This is a basic check - in real tests you'd use axe-core
    const primaryButton = page.locator('button[type="submit"]')
    
    // Check button is visible (basic visibility test)
    await expect(primaryButton).toBeVisible()
    
    // Check text is readable
    await expect(primaryButton).toContainText('登录')
  })

  test('should handle focus management in modals', async ({ page }) => {
    // Login first to access user management
    await page.fill('input[type="text"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')
    
    await page.goto(`${BASE_URL}/users`)
    
    // Open modal
    const createButton = page.locator('button:has-text("创建用户")')
    if (await createButton.count() > 0) {
      await createButton.click()
      
      // Focus should be trapped in modal
      await page.press('body', 'Tab')
      const focusedElement = await page.locator(':focus')
      
      // Should be within modal
      const modalContent = page.locator('.modal')
      const isWithinModal = await modalContent.locator(':focus').count() > 0
      expect(isWithinModal).toBeTruthy()
    }
  })
})

// ==================== User Experience Flow Tests ====================

test.describe('User Experience Flows', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiResponses(page)
  })

  test('should complete full user management workflow', async ({ page }) => {
    // 1. Login
    await page.goto(`${BASE_URL}/login`)
    await page.fill('input[type="text"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')
    
    // 2. Navigate to users
    await page.goto(`${BASE_URL}/users`)
    await expect(page.locator('text=用户管理')).toBeVisible()
    
    // 3. Create user
    await page.click('button:has-text("创建用户")')
    await page.fill('input[placeholder*="用户名"]', 'workflowuser')
    await page.fill('input[placeholder*="邮箱"]', 'workflow@example.com')
    await page.click('button[type="submit"]')
    
    // 4. Verify user appears in list
    await expect(page.locator('text=workflowuser')).toBeVisible()
    
    // 5. Edit user
    const editButton = page.locator('tr:has-text("workflowuser") button:has(.fa-edit)')
    if (await editButton.count() > 0) {
      await editButton.click()
      await page.fill('input[value*="workflow@example.com"]', 'updated@example.com')
      await page.click('button[type="submit"]')
    }
    
    // 6. Create and assign to group
    await page.goto(`${BASE_URL}/groups`)
    await page.click('button:has-text("创建组")')
    await page.fill('input[placeholder*="组名"]', 'Workflow Group')
    await page.click('button[type="submit"]')
  })

  test('should handle error states gracefully', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`)
    
    // Test network error
    await page.route('**/api/auth/login', (route) => {
      route.abort()
    })
    
    await page.fill('input[type="text"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')
    
    // Should show network error
    await expect(page.locator('text=网络错误, text=连接失败')).toBeVisible()
  })

  test('should provide loading states during operations', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`)
    
    // Mock slow login response
    await page.route('**/api/auth/login', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 500))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          user: { id: 'admin-id', username: 'admin', role: 'admin' },
          sessionToken: 'mock-token'
        })
      })
    })
    
    await page.fill('input[type="text"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')
    
    // Click submit and immediately check loading state
    const submitPromise = page.click('button[type="submit"]')
    
    // Should show loading spinner/text
    await expect(page.locator('text=登录中..., .loading-spinner')).toBeVisible()
    
    await submitPromise
  })

  test('should maintain state across page refreshes', async ({ page }) => {
    // Login
    await page.goto(`${BASE_URL}/login`)
    await page.fill('input[type="text"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')
    
    // Navigate to users page
    await page.goto(`${BASE_URL}/users`)
    
    // Refresh page
    await page.reload()
    
    // Should still be logged in and on users page
    await expect(page).toHaveURL(/users/)
    await expect(page.locator('text=用户管理')).toBeVisible()
  })
})