// Public entry point for `lineageguard/runtime`. The implementation lives in
// ./runtime/: types.ts (public types and errors), snapshot.ts (option, stage
// and snapshot validation), tool-gate.ts (the registered-tool boundary) and
// session.ts (the serial supervisor).
export * from "./runtime/types.ts";
export { LineageGuardSession } from "./runtime/session.ts";
