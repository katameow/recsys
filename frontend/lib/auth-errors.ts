import { signIn } from 'next-auth/react';

export type AuthErrorType = 'RefreshTokenError' | 'AccessDenied' | 'NetworkError' | 'ValidationError';

export interface AuthError {
  type: AuthErrorType;
  message: string;
  code?: string;
  details?: unknown;
}

// Create standardized auth errors
export const createAuthError = (
  type: AuthErrorType, 
  message: string, 
  code?: string, 
  details?: unknown
): AuthError => ({
  type,
  message,
  code,
  details
});

// Handle RefreshTokenError from NextAuth session
export const handleRefreshTokenError = async (provider = 'google') => {
  console.warn('Refresh token expired, forcing re-authentication');
  
  try {
    await signIn(provider, { 
      callbackUrl: window.location.pathname + window.location.search 
    });
  } catch (error) {
    console.error('Failed to trigger re-authentication:', error);
  }
};

// Error recovery strategies
export const authErrorHandlers = {
  RefreshTokenError: async (error: AuthError) => {
    // Force sign-in to get new tokens
    await handleRefreshTokenError();
  },
  
  AccessDenied: (error: AuthError) => {
    // Redirect to unauthorized page or show message
    console.warn('Access denied:', error.message);
    // Could redirect to /unauthorized page
  },
  
  NetworkError: (error: AuthError) => {
    // Retry logic or offline handling
    console.warn('Network error during auth:', error.message);
    // Could show retry button or offline message
  },
  
  ValidationError: (error: AuthError) => {
    // Show validation error to user
    console.error('Validation error:', error.message);
    // Could show form validation errors
  }
} as const;

// Handle auth errors with automatic recovery
export const handleAuthError = async (error: AuthError) => {
  const handler = authErrorHandlers[error.type];
  if (handler) {
    await handler(error);
  } else {
    console.error('Unhandled auth error:', error);
  }
};

// Utility to extract error info from responses
export const parseApiError = (error: unknown): AuthError => {
  if (error instanceof Error) {
    // Check for network errors
    if (error.message.includes('fetch')) {
      return createAuthError('NetworkError', 'Network request failed', undefined, error);
    }
    
    return createAuthError('ValidationError', error.message, undefined, error);
  }
  
  // Handle API response errors
  if (typeof error === 'object' && error !== null) {
    const errorObj = error as Record<string, unknown>;
    
    if (errorObj.status === 401) {
      return createAuthError('AccessDenied', 'Authentication required');
    }
    
    if (errorObj.status === 403) {
      return createAuthError('AccessDenied', 'Access forbidden');
    }
    
    if (errorObj.message && typeof errorObj.message === 'string') {
      return createAuthError('ValidationError', errorObj.message);
    }
  }
  
  return createAuthError('ValidationError', 'Unknown error occurred', undefined, error);
};

// Hook for handling auth errors in components
export const retryWithAuth = async <T>(
  operation: () => Promise<T>,
  maxRetries = 1
): Promise<T> => {
  let lastError: AuthError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = parseApiError(error);
      
      // Only retry for certain error types
      if (lastError.type === 'RefreshTokenError' && attempt < maxRetries) {
        await handleAuthError(lastError);
        continue; // Retry after handling refresh token error
      }
      
      // Don't retry for other error types
      break;
    }
  }
  
  // If we get here, all retries failed
  await handleAuthError(lastError!);
  throw lastError!;
};