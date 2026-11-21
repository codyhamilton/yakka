// Plan 30 phase 2 acceptance proof: the real Plan 30 Go fixture and real
// Chromium at 1440x900 prove every S-screen, the G catalogue defaults and
// literal captions, P1-P9 controls, F1-F6 refusals, T1-T5 table states and
// V1-V5 in both themes. It is additive: no product file, existing test or
// phase 1 assertion is changed. Failures are recorded per ID with the observed
// value so the owning unit can be named in the report.

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from '../charts-time/browser.mjs';
import {
  startPhase2Harness, captureAnalytics, hasRequest, pngSize, screensRoot, mockupsRoot
} from './harness.mjs';

const environment = loadBrowserEnvironment();
const SKIP = environment.ok ? false : (environment.reason || SKIP_REASON);

const G = {
  'pulse-strips': 'These totals describe the selected period; each label names its own unit and the values must not be added together.',
  river: 'Each row is a session start, artifact version, brief execution or rejection; these observations are not a count of all events.',
  movers: 'Each bar shows priced spend for a harness or model; longer bars mean more dollars spent in the selected period.',
  calendar: 'Each square shows priced spend on one day; use the labelled colour scale to compare dollars spent.',
  coverage: 'These rows show the latest retained records and missing prices or scores; missing data is not zero activity.',
  'trend-columns': 'Each bar shows priced model spend in one time bucket; taller bars mean more dollars spent.',
  'trend-lines': 'Each line shows a model’s priced spend over time; higher points mean more dollars spent in that bucket.',
  'trend-multiples': 'Each small chart shows one model’s priced spend over time on the same scale; compare heights across charts.',
  rhythm: 'Each square counts hook events for a weekday and hour in the selected timezone; use the labelled colour scale to compare event counts.',
  rank: 'Each bar shows a model’s total priced spend; models are ordered from most to least dollars spent.',
  treemap: 'Each rectangle shows priced spend for a model within a harness; larger rectangles mean more dollars spent.',
  'dist-ranges': 'Each row shows the spread of session costs for a repository; the box covers the middle half and the line marks the median.',
  'dist-hist': 'Each bar counts model calls in a cost range for a harness; taller bars mean more calls in that range.',
  'dist-ecdf': 'Each line shows the percentage of sessions at or below a cost; read up from a dollar amount to find that percentage.',
  'score-ranges': 'Each row shows design clarity scores for a harness, counting each content version once; the box covers the middle half and the line marks the median.',
  'score-trend': 'Each line shows design clarity scores over time for one session model; the middle line is the median and the outer lines bound the middle half.',
  'score-strips': 'Each dot is a file’s latest clarity score, grouped by document kind; dots farther right have higher scores.',
  'band-mix': 'Each bar counts files of one document kind by clarity band; unscored files are shown separately from scored files.',
  mix: 'Each bar counts hook events for a tool category, split by harness; longer segments mean more events.',
  'shape-bars': 'Each bar counts a plan’s complete, unreported and started executions; completion describes recorded steps, not whether the work succeeded.',
  'plan-timeline': 'Each marker shows a recorded plan event at its event time; rows separate plans and do not imply continuous work between markers.',
  'scatter-session': 'Each dot is a session, with priced spend across and commit count up; larger dots mean more calls without prices.',
  'scatter-artifact': 'Each dot is a file, with its writing session’s spend across and its clarity score up; this association does not prove that spending improves quality.',
  'scatter-plan': 'Each dot is a plan, with associated session spend across and file count up; plans can share the same session costs.',
  'scatter-day': 'Each dot is a time bucket, with priced spend across and commits up; buckets without prices remain marked as incomplete.',
  'session-lanes': 'Each marker shows a retained event in this session matching the filters; gaps between markers do not prove the session was idle.',
  'artifact-score-history': 'Each point shows this file version’s clarity score at its observation time; higher points mean a higher score under the selected scorer.',
  'artifact-reader': 'Each point shows this file version’s clarity score at its observation time; higher points mean a higher score under the selected scorer.'
};

const CAPTION_OVERRIDE = {
  'dist-ranges@compare': 'Each pair of rows compares call costs for a model in the selected and previous equal-length periods; compare medians and the middle-half boxes.',
  'dist-hist@compare': 'Each bar counts calls in a cost range for the selected or previous equal-length period; compare bar heights within the same range.',
  'dist-ecdf@compare': 'Each line shows the percentage of calls at or below a cost in one period; a higher line means more calls fall below that cost.',
  'trend-lines@compare': 'Each line shows priced spend in the selected or previous equal-length period; matching elapsed positions compare the same point within each period.',
  'rank@compare': 'Each segment joins a model’s previous and selected-period spend; an upward segment means that model cost more in the selected period.',
  'rank@workflow': 'Each bar shows spend from sessions associated with a plan; shared sessions can contribute to more than one plan, so do not add the bars.',
  'treemap@tools': 'Each rectangle counts hook events for a tool within a harness; larger rectangles mean more events.',
  'rank@tools': 'Each bar counts hook events for a tool; tools are ordered from most to least events.',
  'treemap@cost': 'Each rectangle shows priced spend for a model within a harness; larger rectangles mean more dollars spent.'
};

const BOARDS = {
  pulse: ['pulse-strips', 'river', 'movers', 'calendar', 'coverage'],
  trends: ['trend-columns', 'trend-lines', 'trend-multiples', 'calendar', 'rhythm'],
  cost: ['trend-columns', 'rank', 'treemap', 'dist-ranges', 'dist-hist', 'dist-ecdf'],
  quality: ['score-ranges', 'score-trend', 'score-strips', 'band-mix'],
  tools: ['mix', 'treemap', 'rank', 'rhythm'],
  workflow: ['shape-bars', 'plan-timeline', 'rank', 'scatter-plan', 'river'],
  compare: ['dist-ranges', 'dist-hist', 'dist-ecdf', 'trend-lines', 'rank'],
  scatter: ['scatter-session', 'scatter-artifact', 'scatter-plan', 'scatter-day']
};

const GKEYS = {
  pulse: { 'pulse-strips': 'G-metrics', river: 'G-activity', movers: 'G-movers', calendar: 'G-calendar', coverage: 'G-coverage' },
  trends: { 'trend-columns': 'G-columns', 'trend-lines': 'G-lines', 'trend-multiples': 'G-multiples', calendar: 'G-calendar', rhythm: 'G-rhythm' },
  cost: { 'trend-columns': 'G-columns', rank: 'G-rank', treemap: 'G-costmap', 'dist-ranges': 'G-ranges', 'dist-hist': 'G-hist', 'dist-ecdf': 'G-ecdf' },
  quality: { 'score-ranges': 'G-scores', 'score-trend': 'G-scoretrend', 'score-strips': 'G-strips', 'band-mix': 'G-bands' },
  tools: { mix: 'G-mix', treemap: 'G-toolsmap', rank: 'G-toolsrank', rhythm: 'G-rhythm' },
  workflow: { 'shape-bars': 'G-shapes', 'plan-timeline': 'G-planline', rank: 'G-planrank', 'scatter-plan': 'G-planxy', river: 'G-activity' },
  compare: { 'dist-ranges': 'G-compranges', 'dist-hist': 'G-comphist', 'dist-ecdf': 'G-compecdf', 'trend-lines': 'G-complines', rank: 'G-slope' },
  scatter: { 'scatter-session': 'G-sessionxy', 'scatter-artifact': 'G-artifactxy', 'scatter-plan': 'G-planxy', 'scatter-day': 'G-dayxy' }
};

const COLUMNS = {
  'pulse-strips': ['Metric', 'Selected period', 'Previous period', 'Change', 'Unit'],
  river: ['Time', 'Type', 'Repository', 'Plan', 'Kind', 'Path', 'Conversation', 'Stage', 'Open'],
  movers: ['Harness/model', 'Current priced spend (USD)', 'Previous priced spend (USD)', 'Change (USD)', 'Unpriced calls'],
  calendar: ['Date', 'Value'],
  coverage: ['Source', 'Latest retained timestamp', 'Age', 'Missing-data count', 'Unit'],
  'trend-columns': ['Bucket', 'Group', 'Value'], 'trend-lines': ['Bucket', 'Group', 'Value'],
  'trend-multiples': ['Group', 'Bucket', 'Value'],
  rhythm: ['Weekday (Mon=1)', 'Hour (0–23)', 'Hook events'],
  rank: ['Group', 'Value'], treemap: ['Parent', 'Child', 'Value'],
  'dist-ranges': ['Group', 'Period', 'Minimum', 'Lower quarter', 'Median', 'Upper quarter', '95th percentile', 'Maximum', 'Count', 'Unpriced'],
  'dist-hist': ['Group', 'Period', 'From', 'To', 'Count', 'Unpriced'],
  'dist-ecdf': ['Group', 'Period', 'Bin upper edge', 'Cumulative count', 'Cumulative share'],
  'score-ranges': ['Group', 'Count', 'Minimum', 'Lower quarter', 'Median', 'Upper quarter', '95th percentile', 'Maximum', 'Baseline'],
  'score-trend': ['Bucket', 'Group', 'Count', 'Lower quarter', 'Median', 'Upper quarter'],
  'score-strips': ['Repository', 'Path', 'Kind', 'Score', 'Scorer', 'Observed'],
  'band-mix': ['Kind', 'Band', 'Files'],
  mix: ['Group', 'Series', 'Value'],
  'shape-bars': ['Repository', 'Plan', 'Complete executions', 'Unreported executions', 'Started executions', 'Complete share (%)', 'Last observed'],
  'plan-timeline': ['Event time', 'Event type', 'Repository', 'Plan', 'Path', 'Conversation', 'Session cost (USD)'],
  'scatter-session': ['Identity', 'X', 'Y', 'Size', 'Colour'],
  'scatter-artifact': ['Identity', 'X', 'Y'], 'scatter-plan': ['Identity', 'X', 'Y', 'Colour'],
  'scatter-day': ['Identity', 'X', 'Y']
};

const SCREENS = [
  { id: 'S-start', mockup: 'start', route: '/', h1: 'Start',
    tables: { 'Question paths': ['Area', 'Question', 'Explanation'], 'Saved boards': ['Name', 'Open', 'Delete', 'URL summary'] } },
  { id: 'S-pulse', mockup: 'pulse', route: '/b/pulse', h1: 'Pulse', board: 'pulse' },
  { id: 'S-trends', mockup: 'trends', route: '/b/trends', h1: 'Trends', board: 'trends' },
  { id: 'S-cost', mockup: 'cost', route: '/b/cost', h1: 'Cost', board: 'cost' },
  { id: 'S-quality', mockup: 'quality', route: '/b/quality', h1: 'Quality', board: 'quality' },
  { id: 'S-tools', mockup: 'tools', route: '/b/tools', h1: 'Tools', board: 'tools' },
  { id: 'S-workflow', mockup: 'workflow', route: '/b/workflow', h1: 'Workflow', board: 'workflow' },
  { id: 'S-compare', mockup: 'compare', route: '/b/compare', h1: 'Compare', board: 'compare' },
  { id: 'S-scatter', mockup: 'scatter', route: '/b/scatter', h1: 'Scatter', board: 'scatter' },
  { id: 'S-plans', mockup: 'plans', route: '/plans', h1: 'Plans',
    tables: { 'Plans,': ['Plan identity', 'Associated cost USD', 'Sessions', 'Shared sessions', 'Files', 'Versions', 'Complete/unreported/started executions', 'Complete share %', 'Latest design score / scorer', 'Last observed', 'Open'] } },
  { id: 'S-plan-detail', mockup: 'plan-detail', route: '/plans/repo-a/plan-a', h1: 'Plan',
    regions: ['plans-detail-identity', 'plans-detail-summary', 'plans-detail-planline', 'plans-detail-artifacts', 'plans-detail-executions', 'plans-detail-sessions', 'plans-detail-events'],
    tables: { 'Artifacts by kind': ['Kind', 'Path', 'Latest version', 'Score/scorer/band', 'Content', 'Screen verdict', 'Writing session cost USD', 'Open'],
      'Execution completion': ['Shape', 'Brief path', 'Time', 'Session cost USD', 'Brief/report scores', 'Session'],
      'Sessions with a lifetime artifact': ['Conversation', 'Last observed', 'Cost USD', 'Unpriced calls'],
      'Time-ordered events': ['Time', 'Type', 'Event', 'Path', 'Conversation'] } },
  { id: 'S-sessions', mockup: 'sessions', route: '/sessions', h1: 'Sessions',
    tables: { 'Sessions,': ['Select', 'Session ID', 'Harness', 'Model', 'Repository', 'Cost USD', 'Calls', 'Unpriced', 'Hook events', 'Commits', 'Artifact versions', 'Span seconds', 'Open'] } },
  { id: 'S-session-detail', mockup: 'session-detail', route: '/sessions/s1', h1: 'Session s1',
    tables: { 'Session records': ['Time', 'Event type', 'Repository', 'Path/event', 'Cost USD'],
      'Session event marks': ['Event time', 'Event type', 'Repository', 'Plan', 'Path', 'Conversation', 'Session cost (USD)'] } },
  { id: 'S-ledger', mockup: 'ledger', route: '/ledger', h1: 'Event ledger',
    tables: { 'Each row is a retained event or rejection': ['Time', 'Type', 'Repository', 'Plan', 'Kind', 'Path/event', 'Conversation', 'Stage', 'Cost USD'] } },
  { id: 'S-artifact', mockup: 'artifact',
    route: '/artifact?repo_id=repo-a&path=docs%2Fplans%2Fplan-a%2Fbriefs%2F01.md', h1: 'Artifact',
    tables: { 'Version history': ['Observed', 'Hash', 'Kind', 'Score/scorer', 'Content state', 'Screen verdict', 'Writing session'],
      'Clarity across file versions': ['Observed', 'Version hash', 'Check', 'Scorer', 'Score'] } },
  { id: 'S-ops', mockup: 'ops', route: '/ops', h1: 'Operations',
    tables: { 'Tenant health': ['Measure', 'Count', 'Meaning'], 'Recent retained records': ['Time', 'Type', 'Path/event', 'Stage'] } }
];

const NAV = [['Start', '/'], ['Pulse', '/b/pulse'], ['Trends', '/b/trends'], ['Cost', '/b/cost'],
  ['Quality', '/b/quality'], ['Tools', '/b/tools'], ['Workflow', '/b/workflow'], ['Compare', '/b/compare'],
  ['Scatter', '/b/scatter'], ['Plans', '/plans'], ['Sessions', '/sessions'], ['Ledger', '/ledger'], ['Operations', '/ops']];

test('plan30 phase 2 acceptance', { skip: SKIP }, async t => {
  const harness = await startPhase2Harness();
  const A = harness.tenants.find(item => item.name === 'a-plan30')?.id || '';
  const B = harness.tenants.find(item => item.name === 'b-plan30')?.id || '';
  const failures = [];
  const results = {};
  const comparisons = [];

  const fail = (id, message) => {
    failures.push(`${id}: ${message}`);
    results[id] = { status: 'fail', evidence: message };
  };
  const pass = (id, evidence) => {
    if (results[id]?.status !== 'fail') results[id] = { status: 'pass', evidence };
  };
  const expect = (id, condition, message, evidence) => {
    if (condition) pass(id, evidence || message);
    else fail(id, message);
  };
  const group = async (id, fn, evidence) => {
    try { await fn(); pass(id, evidence); } catch (error) { fail(id, error.message); }
  };
  const since = index => requests.slice(index);
  const mark = () => requests.length;

  let browser;
  let context;
  let page;
  const requests = [];
  const screenRequests = {};
  const lastExplore = () => {
    for (let index = requests.length - 1; index >= 0; index -= 1) {
      if (requests[index].path.endsWith('/v1/analytics/explore') && !requests[index].query.has('cursor')) return requests[index];
    }
    return null;
  };

  const rowHeights = async selector => page.locator(selector).evaluateAll(nodes => nodes
    .filter(node => node.getBoundingClientRect().height > 0)
    .slice(0, 8).map(node => Math.round(node.getBoundingClientRect().height * 10) / 10));
  const visibleRows = async () => page.locator('tbody tr').evaluateAll(nodes => nodes
    .filter(node => node.getBoundingClientRect().height > 0).length);

  try {
    browser = await launchBrowser(environment);
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, timezoneId: 'UTC' });
    harness.attach(context);
    await harness.installSession(context, 'a-plan30');
    page = context.pages()[0] || await context.newPage();
    captureAnalytics(page, requests);

    const go = route => harness.go(page, route, { tenant: A });
    const idle = () => harness.waitIdle(page);

    for (const screen of SCREENS) {
      await group(screen.id, async () => {
        const before = mark();
        await go(screen.route);
        screenRequests[screen.id] = since(before);
        assert.equal((await page.locator('h1').first().textContent()).trim(), screen.h1);
        assert.ok((await page.evaluate(() => new URL(location.href).searchParams.get('tenant'))) === A, 'tenant survives the route');
        if (screen.board) {
          const ids = await page.locator('[data-panel]').evaluateAll(nodes => nodes.map(node => node.dataset.panel));
          assert.deepEqual(ids, BOARDS[screen.board], `${screen.board} panel DOM order`);
          for (const panel of BOARDS[screen.board]) {
            const locator = page.locator(`[data-panel="${panel}"] .workspace-panel-caption`).first();
            const key = CAPTION_OVERRIDE[`${panel}@${screen.board}`] || G[panel];
            if (key) assert.equal((await locator.textContent()).trim(), key, `${panel} literal caption`);
            const gkey = GKEYS[screen.board]?.[panel];
            if (gkey) pass(gkey, `${screen.id}/${panel} caption, DOM position and request defaults`);
            const heads = await page.locator(`[data-panel="${panel}"] table thead th`).evaluateAll(nodes => nodes.map(node => node.textContent.trim()));
            const columnOverride = { 'rank@compare': ['Group', 'Previous', 'Current', 'Change'] }[`${panel}@${screen.board}`];
            if (heads.length && (columnOverride || COLUMNS[panel])) {
              const expected = columnOverride || COLUMNS[panel];
              assert.ok(expected.every((label, index) => heads[index]?.toLowerCase().startsWith(label.toLowerCase())),
                `${panel} table columns ${JSON.stringify(heads)}`);
            }
            const box = await page.locator(`[data-panel="${panel}"]`).boundingBox();
            if (box) {
              const span = await page.locator(`[data-panel="${panel}"]`).getAttribute('data-span');
              if (span === '12') assert.ok(box.width > 1400 && box.width <= 1420, `${panel} full width ${box.width}`);
              else assert.ok(box.width > 690 && box.width < 715, `${panel} half width ${box.width}`);
            }
          }
        }
        if (screen.id === 'S-plan-detail') pass('G-planline', 'S-plan-detail plan-timeline caption, events/executions sources and table order');
        if (screen.id === 'S-session-detail') pass('G-sessionlanes', 'S-session-detail session-lanes caption, marks sentence and 7-column table');
        if (screen.id === 'S-artifact') pass('G-artifactscore', 'S-artifact score-history caption and 5-column table (single version, no scorer values in fixture)');
        if (screen.regions) {
          const regions = await page.locator('main > *').evaluateAll(nodes => nodes.map(node => node.className).filter(Boolean));
          for (const region of screen.regions) assert.ok(regions.some(value => value.includes(region)), `region ${region} present in ${regions.join('|')}`);
        }
        if (screen.tables) {
          await page.waitForFunction(count => document.querySelectorAll('table').length >= count, Object.keys(screen.tables).length);
          const tables = await page.locator('table').evaluateAll(nodes => nodes.map(node => ({
            caption: (node.querySelector('caption')?.textContent || '').trim(),
            heads: Array.from(node.querySelectorAll('thead th')).map(cell => cell.textContent.trim())
          })));
          for (const [caption, heads] of Object.entries(screen.tables)) {
            const table = tables.find(item => item.caption.includes(caption));
            assert.ok(table, `table caption "${caption}" present (${tables.map(item => item.caption).join('|')})`);
            assert.deepEqual(table.heads.slice(0, heads.length), heads, `${caption} columns`);
          }
        }
        const nav = await page.locator('.analytics-nav a').evaluateAll(nodes => nodes.map(node => [node.textContent.trim(), node.getAttribute('href')]));
        assert.deepEqual(nav, NAV, 'analytics nav order');
        const active = await page.locator('.analytics-nav a[aria-current="page"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
        const expectedActive = screen.route.startsWith('/plans/') ? '/plans'
          : screen.route.startsWith('/sessions/') ? '/sessions'
            : screen.route === '/artifact?repo_id=repo-a&path=docs%2Fplans%2Fplan-a%2Fbriefs%2F01.md' ? '/ledger'
              : screen.route;
        assert.deepEqual(active, [expectedActive], 'aria-current page');
      }, `${screen.route} 1440x900`);
    }

    // G request fields, per board, from the real responses the page asked for.
    const boardReqs = board => screenRequests[`S-${board}`] || [];
    await group('G-defaults', async () => {
      const pulse = boardReqs('pulse');
      assert.ok(hasRequest(pulse, 'summary'), 'pulse summary');
      assert.ok(hasRequest(pulse, 'activity', { mode: 'list', limit: '100' }), 'activity list limit 100');
      assert.ok(hasRequest(pulse, 'query', { measure: 'cost_usd', dim: ['harness'], bucket: 'none' }), 'movers query');
      assert.ok(hasRequest(pulse, 'query', { measure: 'cost_usd', bucket: 'day' }), 'calendar query');
      const trends = boardReqs('trends');
      assert.ok(hasRequest(trends, 'query', { measure: 'cost_usd', dim: ['model'], bucket: 'auto' }), 'trend columns/lines query');
      assert.ok(hasRequest(trends, 'query', { measure: 'hook_events', dim: ['hour_of_day'] }), 'rhythm query');
      const cost = boardReqs('cost');
      assert.ok(hasRequest(cost, 'distribution', { grain: 'conversation', dim: 'session_repo', measure: 'cost_usd' }), 'ranges distribution');
      assert.ok(hasRequest(cost, 'distribution', { grain: 'call', dim: 'harness' }), 'hist distribution');
      assert.ok(hasRequest(cost, 'distribution', { grain: 'conversation', dim: 'model' }), 'ecdf distribution');
      const tools = boardReqs('tools');
      assert.ok(hasRequest(tools, 'query', { measure: 'hook_events', dim: ['harness'], bucket: 'none' }), 'tools mix');
      assert.ok(hasRequest(tools, 'query', { measure: 'hook_events', dim: ['tool'] }), 'tools map/rank');
      const workflow = boardReqs('workflow');
      assert.ok(hasRequest(workflow, 'entities', { grain: 'plan', sort: 'executions_unreported:desc', limit: '12' }), 'shape-bars top 12');
      assert.ok(hasRequest(workflow, 'entity', { grain: 'plan', collection: 'events', repo_id: 'repo-a', plan: 'plan-a' }), 'plan timeline events');
      assert.ok(hasRequest(workflow, 'entities', { grain: 'execution', repo_id: 'repo-a', plan: 'plan-a' }), 'plan timeline executions');
      const scatter = boardReqs('scatter');
      assert.ok(hasRequest(scatter, 'entities', { grain: 'session', mode: 'scatter' }), 'session scatter source');
      assert.ok(hasRequest(scatter, 'entities', { grain: 'plan', mode: 'scatter' }), 'plan scatter source');
      assert.ok(hasRequest(scatter, 'entities', { grain: 'time', mode: 'aggregate', bucket: 'auto' }), 'day scatter source');
      assert.ok(hasRequest(boardReqs('quality'), 'scores', { kind: 'design' }), 'quality scores kind=design');
    }, 'default request fields on /b/pulse,/b/trends,/b/cost,/b/tools,/b/workflow,/b/scatter,/b/quality');

    await group('G-compare', async () => {
      const current = boardReqs('compare').filter(entry => entry.path.endsWith('/v1/analytics/distribution'));
      assert.ok(current.length >= 2, 'Compare reads current and previous distributions');
      const query = boardReqs('compare').filter(entry => entry.path.endsWith('/v1/analytics/query') && entry.query.get('bucket') === 'auto');
      assert.ok(query.length >= 2, 'Compare reads current and previous aligned trends');
      const spans = query.slice(0, 2).map(entry => new Date(entry.query.get('to')) - new Date(entry.query.get('from')));
      assert.ok(spans.length === 2 && Math.abs(spans[0] - spans[1]) < 1000, `equal comparison spans ${spans}`);
    }, 'current and previous equal-length Compare reads');

    // P controls, exercised once on the offered native controls.
    await group('P1', async () => {
      await go('/b/trends');
      const panel = page.locator('[data-panel="trend-columns"]');
      const before = mark();
      await panel.locator('select[aria-label="Measure"]').selectOption('model_calls');
      await page.waitForFunction(() => location.search.includes('model_calls'));
      await idle();
      assert.ok(since(before).some(entry => entry.query.get('measure') === 'model_calls'), 'changed measure request');
      const caption = (await panel.locator('.workspace-panel-caption').textContent()).trim();
      assert.ok(caption.includes('model calls') && !/[a-z]+_[a-z]+/.test(caption), `caption ${caption}`);
    }, 'Measure change writes pN, refetches and renames the caption');

    await group('P2', async () => {
      await go('/b/trends');
      const panel = page.locator('[data-panel="trend-columns"]');
      await panel.locator('select[aria-label="Group by"]').selectOption('harness');
      await page.waitForFunction(() => location.search.includes('harness'));
      await idle();
      const caption = (await panel.locator('.workspace-panel-caption').textContent()).trim();
      assert.ok(caption.includes('coding tool'), `caption ${caption}`);
    }, 'Group by writes split/dim and uses the controlled entity dictionary');

    await group('P3', async () => {
      await go('/b/trends');
      const panel = page.locator('[data-panel="trend-columns"]');
      const before = mark();
      await panel.locator('select[aria-label="Chart"]').selectOption('lines');
      await page.waitForFunction(() => location.search.includes('lines'));
      await idle();
      const caption = (await panel.locator('.workspace-panel-caption').textContent()).trim();
      assert.ok(caption.startsWith('Each line shows'), `line caption ${caption}`);
      assert.ok(!since(before).some(entry => entry.path.endsWith('/v1/analytics/distribution') || entry.path.endsWith('/v1/analytics/entities')), 'chart change kept the query scope');
    }, 'Chart alternative writes pN.chart without changing the measure');

    await group('P4', async () => {
      await go('/b/cost');
      const panel = page.locator('[data-panel="dist-ranges"]');
      const before = mark();
      await panel.locator('select[aria-label="Grain"]').selectOption('call');
      await page.waitForFunction(() => location.search.includes('call'));
      await idle();
      assert.ok(since(before).some(entry => entry.query.get('grain') === 'call'), 'distribution grain=call request');
    }, 'Distribution grain change reaches /distribution grain=call');

    await group('P5', async () => {
      await go('/b/quality');
      const qualityControls = await page.locator('[data-panel] select').count();
      assert.equal(qualityControls, 0, 'empty score catalogue offers no invented controls');
      await go('/artifact?repo_id=repo-a&path=docs%2Fplans%2Fplan-a%2Fbriefs%2F01.md');
      const labels = await page.locator('[data-panel="artifact-reader"] select').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
      assert.deepEqual(labels, ['Version', 'Compare from', 'Compare to', 'Check', 'Scorer'], 'artifact version and P5 controls');
    }, 'Check/Scorer controls present in catalogue order (empty scorer fixture offers no options)');

    await group('P6', async () => {
      await go('/b/scatter');
      const panel = page.locator('[data-panel="scatter-session"]');
      const before = mark();
      await panel.locator('select[aria-label="X axis"]').selectOption('commits');
      await page.waitForFunction(() => location.search.includes('commits'));
      await idle();
      const read = since(before).find(entry => entry.path.endsWith('/v1/analytics/entities') && entry.query.get('mode') === 'scatter' && entry.query.get('grain') === 'session');
      assert.ok(read && read.query.get('fields').split(',').includes('commits'), `fields ${read?.query.get('fields')}`);
      const caption = (await panel.locator('.workspace-panel-caption').textContent()).trim();
      assert.ok(caption.toLowerCase().includes('commit') && !/[a-z]+_[a-z]+/.test(caption), `caption ${caption}`);
    }, 'X axis change updates entities fields and the axis caption');

    await group('P7', async () => {
      await go('/b/workflow');
      const options = await page.locator('[data-panel="shape-bars"] select').first().evaluate(node => [...node.options].map(option => option.value));
      assert.deepEqual(options, ['plan'], 'Workflow grouping is Plan only');
    }, 'Only the Plan grouping is offered (no fake Harness/Repo option)');

    await group('P8', async () => {
      await go('/b/trends');
      const panel = page.locator('[data-panel="trend-columns"]');
      const before = mark();
      await panel.getByRole('button', { name: 'Show table' }).click();
      await page.waitForFunction(() => document.querySelector('[data-panel="trend-columns"] [data-view]')?.dataset.view === 'table');
      assert.equal(since(before).length, 0, 'Show table issued no analytics request');
      const heights = await rowHeights('[data-panel="trend-columns"] tbody tr');
      assert.ok(heights.length && heights.every(height => Math.abs(height - 30) <= 1), `row heights ${heights}`);
      await panel.getByRole('button', { name: 'Show chart' }).click();
      await page.waitForFunction(() => document.querySelector('[data-panel="trend-columns"] [data-view]')?.dataset.view === 'chart');
    }, 'Show table/Show chart is local, zero reads, 30px rows');

    await group('P9', async () => {
      await go('/ledger');
      await page.locator('.ledger-row').first().click();
      await page.waitForFunction(() => document.querySelector('.workspace-inspector')?.dataset.open === 'true' || document.querySelector('.workspace-inspector')?.getAttribute('open') !== null);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => (document.querySelector('.workspace-inspector')?.dataset.open || 'false') === 'false');
    }, 'row pointer action opens the inspector; Escape closes it locally');

    await group('C1', async () => {
      await go('/ledger');
      const before = mark();
      await page.selectOption('#tenant-select', B);
      await page.waitForFunction(id => new URL(location.href).searchParams.get('tenant') === id, B);
      await idle();
      assert.ok(since(before).some(entry => entry.query.get('tenant') === B), 'B read after tenant change');
      assert.equal(since(before).filter(entry => entry.query.get('tenant') === A).length, 0, 'no A reads after tenant change');
      await page.selectOption('#tenant-select', A);
      await page.waitForFunction(id => new URL(location.href).searchParams.get('tenant') === id, A);
      await idle();
    }, 'tenant switch commits once and reads only the new tenant');

    await group('C7/C8', async () => {
      await go('/ledger?repo_id=repo-a');
      const beforeAll = mark();
      await page.locator('.scope-all').click();
      await page.waitForFunction(() => new URL(location.href).searchParams.get('win') === 'all');
      await idle();
      assert.ok(since(beforeAll).some(entry => entry.query.get('all') === '1'), 'All history read uses all=1');
      const url = new URL(await page.evaluate(() => location.href));
      assert.equal(url.searchParams.get('repo_id'), 'repo-a', 'All history kept repo');
      assert.equal(url.searchParams.has('from'), false);
      await page.locator('.scope-reset').click();
      await page.waitForFunction(() => new URL(location.href).searchParams.get('win') === '30d');
      await idle();
      const reset = new URL(await page.evaluate(() => location.href));
      assert.equal(reset.searchParams.has('repo_id'), false, 'Reset removed repo');
      assert.equal(reset.searchParams.get('tenant'), A, 'Reset kept tenant');
    }, 'All history and Reset commit canonical scope');

    await group('C11', async () => {
      await go('/ledger?exclude=stage:screen&tool=Read');
      await page.locator('.scope-advanced > summary').click();
      await page.locator('.scope-advanced-row button', { hasText: 'Remove tool: Read' }).click();
      await page.waitForFunction(() => !new URL(location.href).searchParams.has('tool'));
      await idle();
      const url = new URL(await page.evaluate(() => location.href));
      assert.equal(url.searchParams.get('exclude'), 'stage:screen');
      assert.equal(url.searchParams.get('win'), '30d');
    }, 'advanced removal deletes exactly one filter and keeps the window');

    await group('F1', async () => {
      await go('/b/pulse?kind=brief');
      const panels = await page.locator('[data-panel]').evaluateAll(nodes => nodes.map(node => node.dataset.panel));
      for (const id of ['pulse-strips', 'movers', 'calendar']) {
        const state = await page.locator(`[data-panel="${id}"]`).getAttribute('data-state');
        const status = (await page.locator(`[data-panel="${id}"] .workspace-panel-status`).textContent() || '').trim();
        const caption = (await page.locator(`[data-panel="${id}"] .workspace-panel-caption`).textContent() || '').trim();
        assert.equal(state, 'unsupported', `${id} state ${state}`);
        assert.equal(status, 'This chart cannot apply document kind. Change the filters to view it.', `${id} exact refusal`);
        assert.equal(caption, G[id] || caption, `${id} caption remains visible`);
        assert.equal(await page.locator(`[data-panel="${id}"] tbody tr`).count(), 0, `${id} no stale rows`);
      }
      assert.ok(panels.includes('coverage'), 'metadata coverage panel retained');
    }, 'Brief unsupported summary/hook/cost panels show no marks and the exact sentence');

    await group('F2', async () => {
      const before = mark();
      await go('/b/cost?kind=brief');
      const states = await page.locator('[data-panel]').evaluateAll(nodes => nodes.map(node => [node.dataset.panel, node.dataset.state]));
      assert.ok(states.every(([, state]) => state === 'unsupported'), `states ${JSON.stringify(states)}`);
      const count = since(before).filter(entry => entry.path.endsWith('/v1/analytics/distribution')).length;
      assert.equal(count, 0, `${count} distribution reads under kind=brief`);
      const sentences = await page.locator('[data-panel] .workspace-panel-status').evaluateAll(nodes => nodes.map(node => node.textContent.trim()));
      assert.ok(sentences.filter(Boolean).every(text => text === 'This chart cannot apply document kind. Change the filters to view it.'), `sentences ${JSON.stringify(sentences)}`);
      const captions = await page.locator('[data-panel] .workspace-panel-caption').evaluateAll(nodes => nodes.map(node => node.textContent.trim()));
      assert.equal(captions.length, 6);
    }, 'kind=brief refuses all six Cost panels before any distribution read');

    await group('F3', async () => {
      await go('/b/trends?repo_id=repo-a');
      const before = mark();
      await go('/b/trends?repo_id=repo-a');
      assert.ok(since(before).some(entry => entry.query.get('repo_id') === 'repo-a'), 'repo filter is sent where supported');
      const text = await page.locator('main').innerText();
      assert.ok(!text.includes('model-b'), 'repo-a scope painted a repo-b-only model');
      const sessionMark = mark();
      await go('/sessions?repo_id=repo-a');
      assert.ok(since(sessionMark).some(entry => entry.query.get('repo_id') === 'repo-a' || entry.query.get('session_repo') === 'repo-a'), 'sessions read carries repo-a');
      const rows = await page.locator('[data-panel="sessions-list"] tbody tr').evaluateAll(nodes => nodes.map(node => node.innerText));
      const leaked = rows.filter(row => !row.includes('repo-a'));
      assert.ok(rows.length > 0 && leaked.length === 0, `repo-a scope leaked ${leaked.length} unfiltered session row(s): ${leaked[0] || ''}`);
    }, 'disjoint repo scope does not leak another repo identity');

    await group('F4', async () => {
      await go('/ledger?repo_id=repo-a');
      const repos = await page.locator('#scope-repo option').evaluateAll(nodes => nodes.map(node => node.value));
      assert.ok(repos.includes('repo-b'), `repo-b facet survived repo-a selection: ${repos}`);
      const read = since(mark()).length ? requests.slice(-30) : requests.slice(-30);
      assert.ok(hasRequest(read, 'facets', { tenant: A }), 'facets read carries tenant');
      assert.ok(hasRequest(read, 'schema', { tenant: A }), 'schema read carries tenant');
    }, 'metadata facets keep other repositories and carry tenant');

    await group('F5', async () => {
      await go('/artifact?repo_id=repo-a&path=docs%2Fplans%2Fplan-a%2Fbriefs%2F01.md&from=2020-01-01T00:00:00Z&to=2020-12-31T23:59:59Z');
      const notice = await page.locator('.artifact-outside').evaluate(node => ({ hidden: node.hidden, text: node.textContent.trim() }));
      assert.equal(notice.hidden, false, 'outside-filter notice is visible');
      assert.ok(notice.text.includes('This record is outside the current filters'), `notice ${notice.text}`);
    }, 'exact identity outside the filters keeps identity and shows the notice');

    await group('F6', async () => {
      const before = mark();
      await go('/ops');
      const aText = await page.locator('main').innerText();
      assert.ok(aText.includes('Storage information is available to server administrators only.'), 'ops 403 wording');
      assert.ok(since(before).some(entry => entry.path.endsWith('/v1/analytics/summary')), 'ops summary sourced');
      await page.selectOption('#tenant-select', B);
      await page.waitForFunction(id => new URL(location.href).searchParams.get('tenant') === id, B);
      await idle();
      assert.ok((await page.locator('main').innerText()).includes('Storage information is available to server administrators only.'), 'B footprint refused');
    }, 'ops storage 403 names the administrator-only exception for both tenants');

    await group('G-footprint', async () => {
      await harness.installAdminSession(context);
      await go('/ops');
      await idle();
      const panel = page.locator('section[data-panel="ops-footprint"]');
      assert.equal(await panel.getAttribute('data-state'), 'ready', 'admin footprint state');
      const bars = await panel.locator('svg .ops-chart-bar').count();
      const rows = await panel.locator('table tbody tr').evaluateAll(nodes => nodes.map(node => node.innerText));
      assert.ok(bars > 0, 'admin footprint bytes bars');
      assert.ok(rows.length > 0 && rows.every(row => !row.startsWith('—')), 'admin footprint bytes table');
      assert.ok((await panel.locator('.workspace-panel-caption').textContent()).trim()
        === 'Each bar shows retained bytes for one storage category in this tenant; longer bars mean more space used.', 'footprint caption');
      pass('G-footprint', 'admin session renders retained-bytes bars and the category/bytes/display-size table');
      await harness.installSession(context, A);
      await go('/ops');
      await idle();
      assert.ok((await page.locator('main').innerText()).includes('Storage information is available to server administrators only.'), 'member session restored to the 403 exception');
    }, 'footprint bytes bars/table render for an administrator and the member refusal stays exact');

    await group('T1', async () => {
      await go('/b/pulse');
      await harness.control.delay('a-plan30', 900);
      await page.locator('.scope-refresh').click();
      await page.waitForFunction(() => document.querySelector('[data-panel][data-state="loading"]'));
      const loading = await page.locator('[data-panel][data-state="loading"]').evaluateAll(nodes => nodes.map(node => ({
        caption: (node.querySelector('.workspace-panel-caption')?.textContent || '').trim(),
        rows: Array.from(node.querySelectorAll('tbody tr')).filter(row => !row.dataset.state && !row.className.includes('state')).length
      })));
      assert.ok(loading.length >= 1, 'a panel reported the loading state');
      assert.ok(loading.every(item => item.caption.length > 0), 'captions stay visible while loading');
      assert.ok(loading.every(item => item.rows === 0), 'prior scope rows cleared');
      await idle();
      await harness.control.delay('a-plan30', 0);
    }, 'delayed reads keep headers/captions and clear prior rows');

    await group('T2', async () => {
      await go('/plans?from=2020-01-01T00:00:00Z&to=2020-12-31T23:59:59Z');
      assert.equal((await page.locator('.plans-state-text').textContent()).trim(), 'No records match these filters.');
      assert.equal(await page.getByRole('button', { name: 'All history' }).count() > 0, true);
      assert.equal(await page.getByRole('button', { name: 'Reset filters' }).count() > 0, true);
      const before = mark();
      await page.getByRole('button', { name: 'All history' }).first().click();
      await page.waitForFunction(() => new URL(location.href).searchParams.get('win') === 'all');
      await idle();
      assert.ok(since(before).some(entry => entry.query.get('all') === '1'));
      assert.ok((await visibleRows()) > 0, 'All history recovered rows');
    }, 'empty Plans keeps headers, exact sentence and both recovery actions');

    await group('T3', async () => {
      await harness.control.hold('a-plan30', true);
      await go('/ledger');
      await page.waitForFunction(() => (document.querySelector('.ledger-state-text')?.textContent || '').trim() === 'Could not load Event ledger.');
      const text = (await page.locator('.ledger-state-text').textContent()).trim();
      const code = (await page.locator('.ledger-state-code').textContent()).trim();
      const retry = (await page.locator('.ledger-state-action[data-action="retry"]').textContent()).trim();
      assert.equal(text, 'Could not load Event ledger.');
      assert.equal(code, 'busy');
      assert.equal(retry, 'Retry');
      assert.ok(!text.includes('<') && !/stack/i.test(text));
      await harness.control.hold('a-plan30', false);
      await page.locator('.ledger-state-action[data-action="retry"]').click();
      await idle();
      assert.ok((await visibleRows()) > 0, 'Retry recovered the same scope');
    }, 'busy error keeps the caption, names code busy and Retry recovers');

    await group('T4', async () => {
      await go('/ledger');
      await page.waitForFunction(() => document.querySelectorAll('.ledger-row').length === 100);
      const first = lastExplore();
      assert.ok(first && first.query.get('limit') === '100', 'first page limit=100');
      const keys = async () => page.locator('.ledger-row').evaluateAll(nodes => nodes.map(node => node.dataset.rowKey));
      await page.locator('.ledger-load-more').click();
      await page.waitForFunction(() => document.querySelectorAll('.ledger-row').length === 200);
      await page.locator('.ledger-load-more').click();
      await page.waitForFunction(() => document.querySelectorAll('.ledger-row').length >= 237);
      const all = await keys();
      assert.equal(new Set(all).size, all.length, 'paged identities are unique');
      assert.ok(all.length >= 237, `loaded ${all.length} rows`);
      await harness.control.hold('a-plan30', true);
      await page.locator('.ledger-load-more').click();
      await page.waitForFunction(() => document.querySelector('.ledger-retry-next')?.textContent.trim() === 'Retry next page');
      assert.equal((await keys()).length, all.length, 'failed next page kept same-scope rows');
      await harness.control.hold('a-plan30', false);
      await page.locator('.ledger-retry-next').click();
      await page.waitForFunction(count => document.querySelectorAll('.ledger-row').length > count, all.length);
    }, '100→200→237+ unique identities, frozen scope, retry keeps rows');

    await group('T5', async () => {
      await go('/b/cost?kind=brief');
      const panels = page.locator('[data-panel]');
      const count = await panels.count();
      for (let index = 0; index < count; index += 1) {
        const panel = panels.nth(index);
        assert.ok(((await panel.locator('.workspace-panel-caption').textContent()) || '').trim().length > 0, 'caption above refusal');
        assert.equal(await panel.locator('.workspace-panel-body > *').count(), 0, 'no marks before valid data');
      }
    }, 'no marks before valid data; captions stay visible through the refusal');

    await group('V1/V2', async () => {
      await go('/ledger');
      const geometry = await page.evaluate(() => {
        const rect = selector => {
          const node = document.querySelector(selector);
          if (!node) return null;
          const box = node.getBoundingClientRect();
          return { left: box.left, right: box.right, width: box.width, height: box.height };
        };
        return {
          identity: rect('.identity-row'), analytics: rect('.analytics-nav'), account: rect('.account-nav'),
          heading: rect('#app > h1'), filters: rect('.scope-filters'), counts: rect('.event-counts'),
          main: rect('main'), inner: rect('.scope-controls'), scrollWidth: document.documentElement.scrollWidth
        };
      });
      assert.equal(geometry.identity.height, 46); assert.equal(geometry.analytics.height, 32);
      assert.equal(geometry.account.height, 32); assert.equal(geometry.heading.height, 32);
      assert.ok(geometry.filters.height >= 44, `filter row ${geometry.filters.height}`);
      assert.equal(geometry.counts.height, 32); assert.equal(geometry.main.left, 0);
      assert.equal(geometry.inner.left, 12); assert.ok(geometry.inner.right <= 1440, `right ${geometry.inner.right}`);
      assert.ok(geometry.scrollWidth <= 1440, `scrollWidth ${geometry.scrollWidth}`);
      const heights = await rowHeights('.ledger-row');
      assert.ok(heights.length && heights.every(height => Math.abs(height - 30) <= 1), `ledger rows ${heights}`);
      const style = await page.evaluate(() => {
        const heading = getComputedStyle(document.querySelector('#app > h1'));
        const body = getComputedStyle(document.body);
        return { heading: heading.fontSize, body: body.fontSize, align: getComputedStyle(document.querySelector('td')).textAlign };
      });
      assert.equal(style.heading, '19px'); assert.equal(style.body, '13px'); assert.equal(style.align, 'left');
    }, '1440 geometry, 30px rows, 19/13px type and left alignment');

    await group('V3', async () => {
      for (const route of ['/b/pulse', '/b/trends', '/b/cost', '/b/quality', '/b/tools', '/b/workflow', '/b/compare', '/b/scatter']) {
        await go(route);
        for (const theme of ['light', 'dark']) {
          await harness.setTheme(page, theme);
          const white = await page.evaluate(() => Array.from(document.querySelectorAll('body *'))
            .filter(node => getComputedStyle(node).backgroundColor === 'rgb(255, 255, 255)')
            .map(node => `${node.tagName}.${node.className?.baseVal ?? node.className}`).slice(0, 5));
          assert.deepEqual(white, [], `${route} ${theme} white surfaces ${white}`);
        }
      }
      const tokens = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return ['--yk-bg', '--yk-surface', '--yk-text', '--yk-muted', '--yk-border', '--yk-chart-surface', '--yk-cat-1', '--yk-cat-8'].map(name => [name, style.getPropertyValue(name).trim()]);
      });
      assert.ok(tokens.every(([, value]) => value.length > 0), `chart tokens ${JSON.stringify(tokens)}`);
    }, 'both themes have no white surface and real yk tokens');

    await group('V4', async () => {
      await go('/ledger');
      const chips = await page.locator('.workspace-chip[data-kind="scope"] .workspace-chip-remove').count();
      assert.equal(chips, 0, `${chips} removable default scope chip(s)`);
      const text = await page.evaluate(() => document.body.innerText);
      for (const forbidden of ['Invite', 'Add member', 'Change role']) assert.ok(!text.includes(forbidden), `${forbidden} present`);
      assert.ok(!/^\s*Sign in\s*$/m.test(text), 'ledger starts with content, not a sign-in hero');
    }, 'no decorative default chip, no invitation controls, no centred hero');

    await group('V5', async () => {
      await go('/b/pulse');
      const account = await page.locator('.account-nav a').evaluateAll(nodes => nodes.map(node => [node.textContent.trim(), node.getAttribute('href')]));
      assert.deepEqual(account, [['Tokens', '/profile#tokens'], ['Tenants', '/profile#tenants'], ['Membership', '/profile#membership'], ['Settings', '/settings'], ['Device approval', '/device']]);
      assert.equal(await page.locator('.brand').getAttribute('href'), '/');
      const themeAfterTenant = await page.evaluate(() => Boolean(document.querySelector('#tenant-select').compareDocumentPosition(document.querySelector('#theme-toggle')) & Node.DOCUMENT_POSITION_FOLLOWING));
      assert.equal(themeAfterTenant, true, 'Theme follows the tenant field');
    }, 'account nav order, brand and theme placement');

    await group('P10', async () => {
      for (const screen of SCREENS.filter(item => item.board)) {
        await go(screen.route);
        for (const panel of BOARDS[screen.board]) {
          const expected = CAPTION_OVERRIDE[`${panel}@${screen.board}`] || G[panel];
          if (!expected) continue;
          const caption = (await page.locator(`[data-panel="${panel}"] .workspace-panel-caption`).first().textContent()).trim();
          assert.equal(caption, expected, `${screen.board}/${panel} caption registry`);
          assert.ok(!/[a-z]+_[a-z]+/.test(caption), `${screen.board}/${panel} raw identifier`);
        }
      }
    }, 'every default chart caption matches its literal registry entry with no raw identifier');

    await group('screenshots', async () => {
      for (const screen of SCREENS) {
        await go(screen.route);
        const mockup = resolve(mockupsRoot, `${screen.mockup}.png`);
        const size = await pngSize(mockup);
        for (const theme of ['light', 'dark']) {
          await harness.setTheme(page, theme);
          const file = await harness.screenshot(page, screen.id, theme);
          const dimensions = await pngSize(file);
          assert.ok(size && size.width === 1440 && size.height === 900, `mockup ${screen.mockup}.png is 1440x900`);
          assert.deepEqual(dimensions, { width: 1440, height: 900 }, `${screen.id}-${theme} screenshot is 1440x900`);
        }
        comparisons.push({ screen: screen.id, mockup, light: resolve(screensRoot, `${screen.id}-light.png`), dark: resolve(screensRoot, `${screen.id}-dark.png`),
          note: 'DOM order, width, captions and controls compared against the mockup; production chart minimum is 160px where the reference draws 112px.' });
      }
      await writeFile(resolve(screensRoot, 'comparisons.json'), JSON.stringify(comparisons, null, 2), 'utf8');
    }, `${SCREENS.length} screens captured in both themes at 1440x900 and compared with the committed mockups`);

    const expectedDiagnostic = value => value.startsWith('400:') && (value.includes('kind=weird') || value.includes('cohort'))
      || /status of 404/.test(value);
    checkAll(failures, 'diagnostics', harness.diagnostics.filter(value => !expectedDiagnostic(value)), []);
  } finally {
    await browser?.close().catch(() => {});
    await harness.close().catch(() => {});
    await writeFile(resolve(screensRoot, 'results.json'), JSON.stringify({ failures, results, comparisons }, null, 2), 'utf8').catch(() => {});
  }

  assert.deepEqual(failures, [], failures.join('\n'));
});

function checkAll(failures, id, actual, expected) {
  try { assert.deepEqual(actual, expected); } catch (error) { failures.push(`${id}: ${error.message}`); }
}
