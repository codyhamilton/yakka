export function createScheduler({ fetchImpl = fetch, maxInFlight = 4, onChange = () => {} } = {}) {
  maxInFlight = Math.min(4, Math.max(1, maxInFlight));
  const active = new Map();
  const queue = [];
  const inFlight = new Map();
  let sequence = 0;
  const emit = () => onChange({ inFlight: inFlight.size, queued: queue.length });
  async function pump() {
    while (inFlight.size < maxInFlight && queue.length) {
      const item = queue.shift();
      if (item.controller.signal.aborted) {
        active.delete(item.key);
        item.reject(new DOMException('Aborted', 'AbortError'));
        emit();
        continue;
      }
      inFlight.set(item.id, item); emit();
      try { item.resolve(await fetchImpl(item.url, { ...item.init, signal: item.controller.signal })); }
      catch (error) { item.reject(error); }
      finally { inFlight.delete(item.id); active.delete(item.key); emit(); pump(); }
    }
  }
  function request(url, init = {}, stateKey = '') {
    const key = `${init.method || 'GET'} ${url}`;
    const prior = active.get(key);
    if (prior) return prior.promise;
    const id = ++sequence;
    const controller = new AbortController();
    if (init.signal) {
      if (init.signal.aborted) controller.abort();
      else init.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const item = { id, key, url, init, controller, resolve, reject, promise, stateKey };
    active.set(key, item); queue.push(item); pump();
    promise.abort = () => controller.abort();
    return promise;
  }
  function supersede(stateKey) {
    for (const item of active.values()) if (item.stateKey === stateKey) item.controller.abort();
  }
  return { request, supersede, get inFlight() { return inFlight.size; }, get queued() { return queue.length; } };
}
