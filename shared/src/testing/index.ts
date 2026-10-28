// Test doubles barrel — imported as `@core/shared/testing`. Kept out of the runtime barrel so the
// fakes never ship in the server/engine production bundles.

export * from "./fake-store.js"
export * from "./fake-subagent.js"
