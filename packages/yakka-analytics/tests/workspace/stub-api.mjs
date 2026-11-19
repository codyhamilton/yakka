// Deterministic same-origin stub of the analytics API, generated from the
// committed fixture manifest. Test-only: product code never imports this.

import { makeSchema, activityProbe, activityList, summary, population, adminStatus, explorePage, COUNTS, p10Schema, p10Summary, p10Query, p10Distribution, p10Entities, p10Scores, p10ScoreSeries, p10Baselines, p11Schema, p11Scatter, p11ArtifactScatter, p11PlanScatter, p11TimeScatter, p11TimeAggregate, p11Scores, p11Entities, p11Aggregate, p11SessionList, p11Conversation, p11Entity, p12Schema, p12PlanEntities, p12PlanDetailPage, p12PlanScatter, p12PlanAggregate, p12ExecutionEntities, p12PlanEvents, p12PlanArtifactEntities, p12PlanSessions, p12SessionEntities, p12ArtifactEntities, p12Content, p12Baselines } from './fixture.mjs';

const json = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
};

const text = (response, status, body, headers = {}) => {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  response.end(body);
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
    sessionError: false,
    planSampled: false,
    planError: false,
    p10: false,
    p11: false,
    p12: false,
    requests: []
  };
  let probes = 0;

  function schema() {
    if (state.p12) return p12Schema();
    if (state.p11) return p11Schema();
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
      if (state.p12 && query.get('population') === 'content') {
        json(response, 200, p12Baselines({ kind: query.get('kind') || 'design', check: query.get('check') || '', scorer: query.get('scorer') || '' }));
        return true;
      }
      json(response, 200, state.p10 ? p10Baselines() : { kind: query.get('kind') || 'design', checks: {} });
      return true;
    }

    if (path.startsWith('/v1/analytics/')) state.requests.push({ path, search: url.search || '' });

    if (state.p12 && path.startsWith('/v1/analytics/')) {
      if (path === '/v1/analytics/entities') {
        const grain = query.get('grain') || 'plan';
        const mode = query.get('mode') || 'list';
        if (grain === 'plan' && mode === 'scatter') {
          const fields = (query.get('fields') || '').split(',').filter(Boolean);
          json(response, 200, p12PlanScatter({ fields, sampled: state.planSampled === true }));
          return true;
        }
        if (grain === 'plan' && mode === 'aggregate') {
          json(response, 200, p12PlanAggregate({ stat: query.get('stat') || 'count', predicate: query.get('predicate') || '' }));
          return true;
        }
        if (grain === 'plan' && state.planError) {
          json(response, 500, { error: 'plans read failed', code: 'read failed' });
          return true;
        }
        if (grain === 'plan' && state.empty) {
          json(response, 200, {
            grain, rows: [],
            population: { grain, unit: 'plan', scope_n: 0, cohort_n: 0, eligible_n: 0, returned_n: 0, missing_by_reason: {}, relation: null }
          });
          return true;
        }
        if (grain === 'plan') {
          // A detail row is named by (repo_id, plan); the list request carries
          // no `plan` filter and keeps its exact ten-plan population.
          if (query.get('plan')) {
            json(response, 200, p12PlanDetailPage({
              repo_id: query.get('repo_id') || '',
              plan: query.get('plan') || '',
              limit: Number(query.get('limit')) || 4,
              cursor: query.get('cursor') || ''
            }));
            return true;
          }
          json(response, 200, p12PlanEntities({
            sort: query.get('sort') || 'last_ts:desc',
            limit: Number(query.get('limit')) || 12,
            cursor: query.get('cursor') || '',
            cohort: query.has('cohort'),
            filters: {
              repo_id: query.getAll('repo_id'),
              harness: query.getAll('harness'),
              session_model: query.getAll('session_model')
            }
          }));
          return true;
        }
        if (grain === 'execution') {
          json(response, 200, p12ExecutionEntities({
            plan: query.get('plan') || '',
            repo_id: query.get('repo_id') || '',
            limit: Number(query.get('limit')) || 12,
            cursor: query.get('cursor') || ''
          }));
          return true;
        }
        if (grain === 'artifact' && mode === 'scatter') {
          json(response, 200, p11ArtifactScatter({ fields: (query.get('fields') || '').split(',').filter(Boolean) }));
          return true;
        }
        if (grain === 'artifact' && (query.get('plan') || query.get('repo_id'))) {
          json(response, 200, p12PlanArtifactEntities({
            repo_id: query.get('repo_id') || '',
            plan: query.get('plan') || '',
            limit: Number(query.get('limit')) || 4,
            cursor: query.get('cursor') || ''
          }));
          return true;
        }
        if (grain === 'artifact') {
          const base = p10Entities('artifact');
          json(response, 200, {
            ...base,
            rows: base.rows.map(row => ({
              ...row,
              id: { repo_id: row.l.repo_id, path: row.l.path, content_hash: row.l.content_hash },
              l: { ...row.l, plan: '20-analytics-reset' }, flags: {}
            }))
          });
          return true;
        }
        if (grain === 'session' && query.has('id')) {
          json(response, 200, p12SessionEntities({
            ids: query.getAll('id'),
            limit: Number(query.get('limit')) || 4
          }));
          return true;
        }
        json(response, 200, { grain, rows: [], population: population(grain, grain, 0) });
        return true;
      }
      if (path === '/v1/analytics/entity') {
        const grain = query.get('grain') || '';
        const collection = query.get('collection') || 'events';
        if (grain === 'artifact') {
          const body = p12ArtifactEntities({
            repo_id: query.get('repo_id') || '',
            path: query.get('path') || '',
            limit: Number(query.get('limit')) || 4,
            cursor: query.get('cursor') || ''
          });
          if (!body) { json(response, 404, { error: 'artifact not found' }); return true; }
          json(response, 200, body);
          return true;
        }
        if (grain === 'plan' && collection === 'events') {
          json(response, 200, p12PlanEvents({
            repo_id: query.get('repo_id') || '',
            plan: query.get('plan') || '',
            limit: Number(query.get('limit')) || 500,
            cursor: query.get('cursor') || ''
          }));
          return true;
        }
        if (grain === 'plan' && collection === 'sessions') {
          json(response, 200, p12PlanSessions({
            repo_id: query.get('repo_id') || '',
            plan: query.get('plan') || '',
            limit: Number(query.get('limit')) || 4,
            cursor: query.get('cursor') || ''
          }));
          return true;
        }
        json(response, 400, { error: 'unsupported plan collection', code: 'unsupported' });
        return true;
      }
      if (path === '/v1/analytics/content') {
        const answer = p12Content(query.get('repo_id') || '', query.get('path') || '', query.get('hash') || '');
        if (answer.text !== undefined) { text(response, answer.status, answer.text, answer.headers); return true; }
        json(response, answer.status, answer.body);
        return true;
      }
    }

    if (state.p11 && path.startsWith('/v1/analytics/')) {
      if (path === '/v1/analytics/entities') {
        const grain = query.get('grain') || 'session';
        const mode = query.get('mode') || 'list';
        // The server's time grid is mode=aggregate with measured fields. mode=scatter
        // is the shared client seam's old name; both answer the bucket rows. stat=count
        // stays the rectangle population below.
        if (grain === 'time' && (mode === 'scatter' || mode === 'aggregate') && query.get('stat') !== 'count') {
          const fields = (query.get('fields') || '').split(',').filter(Boolean);
          json(response, 200, p11TimeScatter({ fields }));
          return true;
        }
        if (mode === 'scatter') {
          const fields = (query.get('fields') || '').split(',').filter(Boolean);
          const body = grain === 'artifact'
            ? p11ArtifactScatter({ fields })
            : grain === 'plan'
              ? p11PlanScatter({ fields })
              : p11Scatter({ fields });
          json(response, 200, body);
          return true;
        }
        if (mode === 'aggregate') {
          const body = grain === 'time'
            ? p11TimeAggregate({ predicate: query.get('predicate') || '' })
            : p11Aggregate({ grain, stat: query.get('stat') || 'count' });
          json(response, 200, body);
          return true;
        }
        if (grain === 'session' && state.sessionError) {
          json(response, 500, { error: 'sessions read failed', code: 'read failed' });
          return true;
        }
        if (grain === 'session' && state.empty) {
          json(response, 200, {
            grain, rows: [],
            population: { grain, unit: 'session', scope_n: 0, cohort_n: 0, eligible_n: 0, returned_n: 0, missing_by_reason: {}, relation: null }
          });
          return true;
        }
        if (grain === 'session') {
          const filters = {};
          for (const key of ['harness', 'session_model', 'session_repo', 'origin', 'has_artifacts', 'id']) filters[key] = query.getAll(key);
          json(response, 200, p11SessionList({
            sort: query.get('sort') || 'last_ts:desc',
            limit: Number(query.get('limit')) || 500,
            cursor: query.get('cursor') || '',
            filters
          }));
          return true;
        }
        json(response, 200, p11Entities(grain));
        return true;
      }
      if (path === '/v1/analytics/conversation') {
        if (query.has('cohort')) {
          json(response, 400, { error: 'cohort is not supported on this route', code: 'cohort_invalid', reason: 'route_not_supported' });
          return true;
        }
        const id = query.get('id') || '';
        if (!id) { json(response, 400, { error: 'id required', code: 'id required' }); return true; }
        const body = p11Conversation(id);
        if (!body) { json(response, 404, { error: 'conversation not found', code: 'not found' }); return true; }
        json(response, 200, body);
        return true;
      }
      if (path === '/v1/analytics/entity') {
        if (query.has('cohort')) {
          json(response, 400, { error: 'cohort is not supported on this route', code: 'cohort_invalid', reason: 'route_not_supported' });
          return true;
        }
        const body = p11Entity({ grain: query.get('grain') || 'session', id: query.get('id') || '' });
        if (!body) { json(response, 404, { error: 'conversation not found', code: 'not found' }); return true; }
        json(response, 200, body);
        return true;
      }
      if (path === '/v1/analytics/scores') {
        json(response, 200, p11Scores({ kind: query.get('kind') || 'design' }));
        return true;
      }
      // Any P11 body not handled here falls through to the P10/default
      // handlers, which later units extend additively.
    }

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
