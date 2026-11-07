export function safeReturnPath(value) {
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/') || value.startsWith('//')) return null;
  if (/[\\\u2028\u2029\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    const parsed = new URL(value, 'https://return.invalid');
    if (parsed.origin !== 'https://return.invalid' || parsed.username || parsed.password) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return null; }
}

export function oauthLoginPath(returnPath) {
  const safe = safeReturnPath(returnPath) || '/';
  const pages = ['yakka.build', 'www.yakka.build'].includes(globalThis.location?.hostname);
  const base = pages ? 'https://api.yakka.build' : '';
  return `${base}/oauth/login?return=${encodeURIComponent(safe)}`;
}

export function oauthCallbackTarget(body) {
  return body?.ok === true ? (safeReturnPath(body.return) || '/') : null;
}
