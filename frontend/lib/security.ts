import { NextRequest, NextResponse } from 'next/server';

// Security headers configuration
export const securityHeaders = {
  // Content Security Policy (start with report-only)
  'Content-Security-Policy-Report-Only': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'", // TODO: Replace with nonces
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'"
  ].join('; '),
  
  // Prevent clickjacking
  'X-Frame-Options': 'DENY',
  
  // Prevent MIME type sniffing
  'X-Content-Type-Options': 'nosniff',
  
  // Referrer policy
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  
  // Permissions policy
  'Permissions-Policy': [
    'camera=()',
    'microphone=()',
    'geolocation=()',
    'payment=()',
    'usb=()',
    'serial=()'
  ].join(', '),
  
  // HSTS (only for HTTPS)
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload'
};

// Apply security headers to response
export function addSecurityHeaders(response: NextResponse): NextResponse {
  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  
  return response;
}

// CSRF validation for API routes
export function validateCSRF(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = request.headers.get('host');
  
  // For non-GET requests, validate origin/referer
  if (request.method !== 'GET') {
    if (!origin && !referer) {
      return false;
    }
    
    const expectedOrigin = `https://${host}`;
    
    if (origin && origin !== expectedOrigin) {
      return false;
    }
    
    if (referer && !referer.startsWith(expectedOrigin)) {
      return false;
    }
  }
  
  return true;
}

// Double-submit CSRF token validation
export function validateDoubleSubmitCSRF(request: NextRequest): boolean {
  const cookieToken = request.cookies.get('csrf-token')?.value;
  const headerToken = request.headers.get('x-csrf-token');
  
  if (!cookieToken || !headerToken) {
    return false;
  }
  
  return cookieToken === headerToken;
}

// Rate limiting helpers (would need Redis in production)
// NOTE: In-memory rate limiting does NOT work reliably in serverless environments (e.g., Vercel, AWS Lambda) because instances are ephemeral and do not share memory.
// For production, use a shared store like Redis.
const rateLimitStore = new Map<string, { count: number; resetTime: number; }>();

export function checkRateLimit(
  key: string, 
  limit: number, 
  windowMs: number
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const current = rateLimitStore.get(key);
  
  if (!current || now > current.resetTime) {
    // Reset window
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetTime: now + windowMs };
  }
  
  if (current.count >= limit) {
    return { allowed: false, remaining: 0, resetTime: current.resetTime };
  }
  
  current.count++;
  return { 
    allowed: true, 
    remaining: limit - current.count, 
    resetTime: current.resetTime 
  };
// Clean up expired rate limit entries during each check
function cleanupRateLimitStore() {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (now > value.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}

// Call cleanup before checking rate limit
export function checkRateLimit(
  key: string, 
  limit: number, 
  windowMs: number
): { allowed: boolean; remaining: number; resetTime: number } {
  cleanupRateLimitStore();
  const now = Date.now();
  const current = rateLimitStore.get(key);
  
  if (!current || now > current.resetTime) {
    // Reset window
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetTime: now + windowMs };
  }
  
  if (current.count >= limit) {
    return { allowed: false, remaining: 0, resetTime: current.resetTime };
  }
  
  current.count++;
  return { 
    allowed: true, 
    remaining: limit - current.count, 
    resetTime: current.resetTime 
  };
}
  }
}, 60000); // Clean up every minute