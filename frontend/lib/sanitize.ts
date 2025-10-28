import DOMPurify from 'dompurify';

// Client-side HTML sanitization utility
export function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined') {
    // Server-side: return as-is or use a server-side sanitizer
    return html;
  }
  
  // Configure DOMPurify to be strict
  const config = {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre'
    ],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ['style', 'on*'],
    FORBID_TAGS: ['script', 'object', 'embed', 'form', 'input', 'button'],
  };
  
  return DOMPurify.sanitize(html, config);
}

// Sanitize text content (strips all HTML)
export function sanitizeText(text: string): string {
  if (typeof window === 'undefined') {
    // Server-side: basic HTML entity encoding
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }
  
  return DOMPurify.sanitize(text, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

// Validate and sanitize URLs
export function sanitizeUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return null;
    }
    return urlObj.toString();
  } catch {
    return null;
  }
}

// CSRF token generation (client-side)
export function generateCSRFToken(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Validate same-origin requests
export function validateOrigin(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.includes(origin);
}

// Check if redirect URL is safe (same-origin only)
export function validateRedirectUrl(url: string, baseUrl: string): string {
  try {
    const redirectUrl = new URL(url, baseUrl);
    const base = new URL(baseUrl);
    
    // Only allow same-origin redirects
    if (redirectUrl.origin !== base.origin) {
      return '/'; // Default fallback
    }
    
    return redirectUrl.pathname + redirectUrl.search;
  } catch {
    return '/'; // Default fallback on invalid URL
  }
}