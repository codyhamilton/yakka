// Follow: off by default. While enabled and the document is visible it probes
// /activity?mode=probe&after=<acknowledged watermark> at the stored interval.
// A successful probe records counts and a new watermark; only acknowledge()
// advances the watermark the next probe starts from. A cancelled or failed
// probe never advances it. Nothing else auto-refreshes.

export const FOLLOW_SECONDS_KEY = 'yakka-analytics-follow-seconds';
export const DEFAULT_FOLLOW_SECONDS = 30;

function storedSeconds(storage, fallback) {
  try {
    const raw = Number(storage?.getItem?.(FOLLOW_SECONDS_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  } catch { return fallback; }
}

function emptyCounts() {
  return { session_start: 0, artifact_version: 0, execution: 0, rejection: 0 };
}

export function createFollow({
  transport,
  tenant = '',
  storage = (() => { try { return globalThis.localStorage; } catch { return null; } })(),
  documentRef = globalThis.document,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  intervalSeconds = storedSeconds(storage, DEFAULT_FOLLOW_SECONDS),
  onChange = () => {}
} = {}) {
  const state = {
    enabled: false,
    polling: false,
    counts: emptyCounts(),
    watermark: '',
    acknowledged: '',
    pendingWatermark: '',
    error: null
  };
  let timer = null;
  let destroyed = false;

  const visible = () => !documentRef || documentRef.visibilityState === undefined || documentRef.visibilityState === 'visible';
  const emit = () => onChange(snapshot());

  function snapshot() {
    return { ...state, counts: { ...state.counts }, seconds: interval };
  }

  let interval = intervalSeconds;

  function clear() {
    if (timer !== null) { clearTimer(timer); timer = null; }
  }

  function schedule() {
    clear();
    if (destroyed || !state.enabled || !visible()) return;
    timer = setTimer(() => { timer = null; probeNow().finally(schedule); }, Math.max(1, interval) * 1000);
  }

  async function probeNow() {
    if (!state.enabled || !visible() || state.polling || destroyed) return null;
    state.polling = true;
    const after = state.acknowledged;
    const params = new URLSearchParams({ mode: 'probe' });
    if (after) params.set('after', after);
    emit();
    try {
      const { response, body } = await transport.get('activity', params, { tenant, stateKey: 'follow' });
      if (!response.ok) {
        state.error = { status: response.status, message: body?.error || 'probe failed' };
        return null;
      }
      state.counts = { ...emptyCounts(), ...(body?.counts || {}) };
      state.watermark = body?.watermark || '';
      state.pendingWatermark = state.watermark;
      state.error = null;
      return body;
    } catch (error) {
      if (error?.name !== 'AbortError') state.error = { status: 0, message: error?.message || 'probe failed' };
      return null;
    } finally {
      state.polling = false;
      emit();
    }
  }

  // Acknowledge advances the next probe's `after` to the last successful
  // watermark. With no successful probe it changes nothing.
  function acknowledge() {
    if (state.pendingWatermark) {
      state.acknowledged = state.pendingWatermark;
      state.watermark = state.pendingWatermark;
      state.pendingWatermark = '';
      state.counts = emptyCounts();
    }
    emit();
    return state.acknowledged;
  }

  function start() {
    if (destroyed) return snapshot();
    state.enabled = true;
    emit();
    probeNow().finally(schedule);
    return snapshot();
  }

  function stop() {
    state.enabled = false;
    clear();
    emit();
    return snapshot();
  }

  function toggle() {
    return state.enabled ? stop() : start();
  }

  function setIntervalSeconds(seconds) {
    const value = Number(seconds);
    if (Number.isFinite(value) && value > 0) interval = value;
    try { storage?.setItem?.(FOLLOW_SECONDS_KEY, String(interval)); } catch {}
    if (state.enabled) schedule();
    emit();
    return interval;
  }

  function onVisibility() {
    if (!state.enabled) return;
    if (visible()) probeNow().finally(schedule);
    else clear();
  }

  documentRef?.addEventListener?.('visibilitychange', onVisibility);

  function destroy() {
    destroyed = true;
    state.enabled = false;
    clear();
    documentRef?.removeEventListener?.('visibilitychange', onVisibility);
  }

  return {
    start, stop, toggle, probeNow, acknowledge, destroy,
    setIntervalSeconds,
    snapshot,
    get enabled() { return state.enabled; },
    get watermark() { return state.acknowledged; },
    get counts() { return { ...state.counts }; }
  };
}
