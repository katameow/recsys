import React from 'react';
import { sanitizeHtml, sanitizeText } from '@/lib/sanitize';

interface SafeHtmlProps {
  html: string;
  className?: string;
  tag?: keyof JSX.IntrinsicElements;
}

// Safe HTML component using centralized DOMPurify-based sanitizer.
// NOTE: Prefer server-side sanitization for any LLM-produced HTML before
// returning it to the client. This client-side sanitizer is a last line of
// defense and will run only in the browser.
export function SafeHtml({ html, className, tag = 'div' }: SafeHtmlProps) {
  const Tag = tag;

  // sanitizeHtml uses DOMPurify on the client and returns the original
  // string on the server. Server-side sanitization should be performed
  // where possible for LLM-produced content.
  const sanitized = sanitizeHtml(html);

  return (
    <Tag
      className={className}
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

// Text-only safe component (strips all HTML)
export function SafeText({ text, className }: { text: string; className?: string }) {
  // Use sanitizer to strip all HTML for consistent behavior client/server
  const textOnly = sanitizeText(text);

  return <span className={className}>{textOnly}</span>;
}

// Safe link component with validation
export function SafeLink({ 
  href, 
  children, 
  className,
  ...props 
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  // Validate URL safety
  const isValidUrl = (url: string) => {
    try {
      const urlObj = new URL(url);
      return ['http:', 'https:', 'mailto:'].includes(urlObj.protocol);
    } catch {
      return false;
    }
  };

  const safeHref = href && isValidUrl(href) ? href : '#';
  
  return (
    <a 
      href={safeHref} 
      className={className}
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  );
}