export const DEFAULT_AUTH_REDIRECT = "/";

export const sanitizeRedirectPath = (path: string | null | undefined): string => {
  if (!path) {
    return DEFAULT_AUTH_REDIRECT;
  }

  const trimmed = path.trim();
  if (!trimmed) {
    return DEFAULT_AUTH_REDIRECT;
  }

  if (trimmed.startsWith("//")) {
    return DEFAULT_AUTH_REDIRECT;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const url = new URL(trimmed);
      return url.pathname + url.search + url.hash;
    } catch {
      return DEFAULT_AUTH_REDIRECT;
    }
  }

  if (!trimmed.startsWith("/")) {
    return DEFAULT_AUTH_REDIRECT;
  }

  return trimmed;
};
