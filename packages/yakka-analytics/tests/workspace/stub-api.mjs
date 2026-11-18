// Deterministic same-origin stub of the analytics API, generated from the
// committed fixture manifest. Test-only: product code never imports this.

import { makeSchema, activityProbe, activityList, summary, population, adminStatus, COUNTS } from './fixture.mjs';

const json = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
};

export function createStubApi() {
  const state = {
    scenario: 'default',
    role: 'admin',
    missingFeature: 'entities_session',
    activityError: false,
    empty: false,
    activityDelayMs: 0,
    statusError: false,
    statusDelayMs: 0,
    statusRequests: 0,
    statusAborted: 0
  };
  let probes = 0;

  function schema() {
    if (state.scenario === 'legacy') return makeSchema({ legacy: true });
    if (state.scenario === 'missing-feature') return makeSchema({ missingFeature: state.missingFeature });
    return makeSchema();
  }

  function handle(request, response, url) {
    const path = url.pathname;
    const query = url.searchParams;

    if (!path.startsWith('/v1/')) return false;

    if (path === '/v1/me') {
      json(response, 200, {
        github_id: 4242,
        login: 'fixture-user',
        name: 'Fixture User',
        tenants: [{ id: 'fixture-tenant', name: 'Fixture', role: state.role }]
      });
      return true;
    }
    if (path === '/v1/admin/status') {
      state.statusRequests += 1;
      const answer = () => {
        if (state.role !== 'admin') { json(response, 403, { error: 'forbidden' }); return; }
        if (state.statusError) { json(response, 500, { error: 'status read failed', code: 'read failed' }); return; }
        json(response, 200, adminStatus());
      };
      if (state.statusDelayMs > 0) {
        let aborted = false;
        const onClose = () => {
          if (response.writableEnded) return;
          aborted = true;
          state.statusAborted += 1;
        };
        response.on('close', onClose);
        setTimeout(() => {
          response.off('close', onClose);
          if (!aborted) answer();
        }, state.statusDelayMs);
      } else answer();
      return true;
    }
    if (path === '/v1/analytics/schema') { json(response, 200, schema()); return true; }

    if (state.scenario === 'legacy' && path !== '/v1/analytics/schema') {
      json(response, 400, { error: 'range too wide', code: 'range too wide', retry: { narrow: 'choose a narrower window' } });
      return true;
    }

    if (path === '/v1/analytics/activity') {
      if (query.get('mode') === 'probe') {
        probes += 1;
        const answer = () => {
          if (state.activityError) { json(response, 500, { error: 'probe failed', code: 'read failed' }); return; }
          if (state.empty) { json(response, 200, { ...activityProbe(), counts: { session_start: 0, artifact_version: 0, execution: 0, rejection: 0 } }); return; }
          json(response, 200, activityProbe());
        };
        if (state.activityDelayMs > 0) setTimeout(answer, state.activityDelayMs);
        else answer();
        return true;
      }
      if (state.empty) { json(response, 200, { ...activityList(), rows: [] }); return true; }
      json(response, 200, activityList());
      return true;
    }

    if (path === '/v1/analytics/summary') { json(response, 200, summary()); return true; }
    if (path === '/v1/analytics/query') {
      json(response, 200, { rows: [], requested: { bucket: query.get('bucket') || 'auto' }, effective: { bucket: 'day' }, population: population('time', 'bucket', 0) });
      return true;
    }
    if (path === '/v1/analytics/entities') {
      const grain = query.get('grain') || 'session';
      json(response, 200, { rows: [], population: population(grain, grain, 0) });
      return true;
    }
    if (path === '/v1/analytics/distribution') { json(response, 200, { groups: [], population: population('session', 'session', COUNTS.sessions_one_repo) }); return true; }
    if (path === '/v1/analytics/series') { json(response, 200, { series: [], population: population('session', 'session', 0) }); return true; }
    if (path === '/v1/analytics/scores') { json(response, 200, { kind: query.get('kind') || 'design', checks: [] }); return true; }
    if (path === '/v1/analytics/conversations') { json(response, 200, { rows: [], population: population('session', 'session', 0) }); return true; }
    if (path === '/v1/analytics/entity') { json(response, 200, { id: {}, versions: [], next: null }); return true; }
    if (path === '/v1/analytics/content') { json(response, 404, { error: 'content_unavailable', reason: 'not_stored' }); return true; }

    json(response, 404, { error: 'not found' });
    return true;
  }

  return {
    state,
    handle,
    set(next = {}) { Object.assign(state, next); },
    get probes() { return probes; }
  };
}
