export interface LocalRequestHeaders {
  origin?: string;
  host?: string;
  token?: string;
}

export function isAllowedLocalHost(host?: string): boolean {
  if (!host) return false;
  try {
    const parsed = new URL(`http://${host}`);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

export function isAllowedLocalOrigin({ origin, host }: LocalRequestHeaders): boolean {
  if (!origin || !host || origin === 'null') return false;
  try {
    const parsed = new URL(origin);
    return isAllowedLocalHost(parsed.host) && parsed.host === host && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
  } catch {
    return false;
  }
}

export function isValidShutdownRequest(headers: LocalRequestHeaders, expectedToken: string): boolean {
  return isAllowedLocalOrigin(headers) && Boolean(expectedToken) && headers.token === expectedToken;
}
