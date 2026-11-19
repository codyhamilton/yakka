// The P10 scene lives with the workspace fixture so both suites share one
// deterministic schema and one set of bodies. This file only re-exports.
export {
  P10, p10Schema, p10Fixture, p10Query, p10Distribution, p10Phase, p10Summary
} from '../workspace/fixture.mjs';
