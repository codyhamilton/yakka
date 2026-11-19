export function legacyErrorMessage(body) {
  if (typeof body?.error === 'string') return body.error;
  return 'Request failed';
}

export function retryHint(body) {
  return typeof body?.retry === 'string' ? body.retry : '';
}
