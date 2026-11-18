// Deterministic same-origin stub of the analytics API, generated from the
// committed fixture manifest. Test-only: product code never imports this.

import { makeSchema, activityProbe, activityList, summary, population, adminStatus, explorePage, COUNTS, p10Schema, p10Summary, p10Query, p10Distribution, p10Entities, p10Scores, p10ScoreSeries, p10Baselines } from './fixture.mjs';

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
    statusAborted: 0,
    p10: false,
    requests: []
  };
  let probes = 0;

  function schema() {
    if (state.p10) return p10Schema();
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
    if (path === '/v1/baselines') {
      state.requests.push({ path, search: url.search || '' });
      json(response, 200, state.p10 ? p10Baselines() : { kind: query.get('kind') || 'design', checks: {} });
      return true;
    }

    if (path.startsWith('/v1/analytics/')) state.requests.push({ path, search: url.search || '' });

    if (state.p10 && path.startsWith('/v1/analytics/')) {
      const from = query.get('from') || '';
      const to = query.get('to') || '';
      const dims = query.getAll('dim').filter(Boolean);
      const withCohort = body => {
        const cohort = query.get('cohort');
        if (!cohort) return body;
        let op = 'include';
        try { op = JSON.parse(cohort).op || 'include'; } catch { op = 'include'; }
        const pop = body.population || {};
        return {
          ...body,
          population: {
            ...pop,
            relation: {
              source_grain: 'session', target_grain: pop.grain || 'session', mapping: 'session',
              op, resolved_n: 42, resolved_unit: 'session', associations: []
            }
          }
        };
      };
      if (path === '/v1/analytics/summary') { json(response, 200, p10Summary()); return true; }
      if (path === '/v1/analytics/query') {
        json(response, 200, withCohort(p10Query({ measure: query.get('measure') || 'cost_usd', dims, bucket: query.get('bucket') || 'auto', from, to })));
        return true;
      }
      if (path === '/v1/analytics/distribution') {
        json(response, 200, withCohort(p10Distribution({ measure: query.get('measure') || 'cost_usd', grain: query.get('grain') || 'call', dim: query.get('dim') || '', from, to })));
        return true;
      }
      if (path === '/v1/analytics/entities') {
        const grain = query.get('grain') || 'session';
        json(response, 200, withCohort(p10Entities(grain)));
        return true;
      }
      if (path === '/v1/analytics/scores') { json(response, 200, withCohort(p10Scores())); return true; }
      if (path === '/v1/analytics/score-series') { json(response, 200, withCohort(p10ScoreSeries())); return true; }
      if (path === '/v1/analytics/baselines') { json(response, 200, p10Baselines()); return true; }
    }

    if (state.scenario === 'legacy' && path !== '/v1/analytics/schema') {
      json(response, 400, { error: 'range too wide', code: 'range too wide', retry: { narrow: 'choose a narrower window' } });
      return true;
    }

    if (path === '/v1/analytics/explore') {
      if (state.empty) { json(response, 200, { rows: [], truncated: false }); return true; }
      const budgets = schema().budgets || {};
      const candidates = [budgets.explore_page_max, budgets.page_max]
        .map(Number).filter(value => Number.isFinite(value) && value > 0);
      const fallback = candidates.length ? Math.min(...candidates) : 500;
      const rawLimit = query.get('limit');
      const limit = rawLimit === null || rawLimit === '' ? fallback : Number(rawLimit);
      json(response, 200, explorePage({ cursor: query.get('cursor') || '', limit }));
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
