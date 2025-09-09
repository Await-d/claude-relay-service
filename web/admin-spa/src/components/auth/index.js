/**
 * Authentication components barrel export
 * 
 * Provides centralized access to authentication components:
 * - LoginForm: User login form with validation and auth method selection
 * - SessionManager: Session management with automatic refresh and expiry handling
 * 
 * These components integrate with the AuthStore and new backend auth API
 * to provide comprehensive authentication and session management.
 */

import LoginForm from './LoginForm.vue'
import SessionManager from './SessionManager.vue'

export {
  LoginForm,
  SessionManager
}

export default {
  LoginForm,
  SessionManager
}