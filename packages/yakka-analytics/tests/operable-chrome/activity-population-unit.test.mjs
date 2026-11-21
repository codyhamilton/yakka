import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVITY_CAPTION, activityPopulationText, mapActivityList
} from '../../web/js/panels/river.js';

test('cohort_n is the matching observation population and eligible_n is only a fallback', () => {
  assert.equal(
    activityPopulationText({ loaded: 16, population: { cohort_n: 16, eligible_n: 20 } }),
    '16 observations displayed of 16 matching observations'
  );
  assert.equal(
    activityPopulationText({ loaded: 16, population: { eligible_n: 20 } }),
    '16 observations displayed of 20 matching observations'
  );
  assert.equal(
    activityPopulationText({ loaded: 16, population: { cohort_n: null, eligible_n: 20 } }),
    '16 observations displayed of 20 matching observations'
  );
});

test('an absent population is unavailable, never of zero', () => {
  const unavailable = '16 observations displayed; matching observation total unavailable.';
  assert.equal(activityPopulationText({ loaded: 16, population: null }), unavailable);
  assert.equal(activityPopulationText({ loaded: 16, population: {} }), unavailable);
  assert.doesNotMatch(activityPopulationText({ loaded: 16, population: {} }), /of 0/);
  assert.equal(activityPopulationText({ loaded: 0, population: { cohort_n: 0 } }), '0 observations displayed of 0 matching observations');
});

test('the G-activity caption is literal and activity rows are never called events', () => {
  assert.equal(
    ACTIVITY_CAPTION,
    'Each row is a session start, artifact version, brief execution or rejection; these observations are not a count of all events.'
  );
  const text = activityPopulationText({ loaded: 4, population: { cohort_n: 4 } });
  assert.match(text, /observations/);
  assert.doesNotMatch(text, /events?/);
});

test('an empty activity response keeps the line honest and does not fabricate a population', () => {
  const result = mapActivityList({ status: 200, body: { rows: [] } });
  assert.equal(result.state, 'empty');
  assert.equal(result.population.cohort_n, undefined);
  assert.equal(result.population.eligible_n, undefined);
  assert.equal(
    activityPopulationText({ loaded: result.rows.length, population: result.population }),
    '0 observations displayed; matching observation total unavailable.'
  );
  const supplied = mapActivityList({ status: 200, body: { rows: [], population: { cohort_n: 0, eligible_n: 0 } } });
  assert.equal(
    activityPopulationText({ loaded: supplied.rows.length, population: supplied.population }),
    '0 observations displayed of 0 matching observations'
  );
});

test('an activity error response reports no rows and no invented matching total', () => {
  const result = mapActivityList({ status: 503, body: { error: 'busy', code: 'busy' } });
  assert.equal(result.state, 'error');
  assert.equal(activityPopulationText({ loaded: 0, population: null }), '0 observations displayed; matching observation total unavailable.');
});
