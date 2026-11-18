// The P11 scene lives with the workspace fixture so every Phase 11 suite
// shares one deterministic schema and one set of bodies. This file only
// re-exports the committed helpers.
export {
  P11, p11Schema, p11Fixture, p11Scatter, p11Entities, p11Aggregate, p11SessionRows, p11SessionId
} from '../workspace/fixture.mjs';
