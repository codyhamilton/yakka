// Every Phase 12 workflow spec uses the same Chromium launch path and named
// skip reason as the earlier phases. Re-export, never duplicate, the loader.
export * from '../workspace/browser.mjs';

// The P12 scene lives with the workspace fixture so every Phase 12 suite shares
// one deterministic schema and one set of bodies. This file only re-exports the
// committed helpers.
export {
  P12, p12Schema, p12Fixture, p12PlanRows, p12PlanEntities,
  p12ExecutionRows, p12ExecutionEntities, p12PlanEvents
} from '../workspace/fixture.mjs';
