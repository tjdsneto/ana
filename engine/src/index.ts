// Start here. This is the engine package's map and public surface — it runs nothing itself.
//
// Entrypoints (each is a process, built to dist/<name>/index.js):
//   worker/index.ts     the engine. Long-running process; `npm start`. Connects Postgres, holds the
//                       LISTEN wake-up, and drains work by running the loop. The only one using Engine.
//   auto-pilot/index.ts dev harness (not product). A Store/services client that seeds briefs and
//                       drives the human gate unattended, so a full production runs with no operator.
//
// Rendering is not here: a render leaf runs the render-film skill, which drives the craft tools in
// craft/tools (vo / build / mix / render). The engine has no render/voice client.
//
// The logic lives in loop.ts (Engine): produce → review internally → mark the data. Read that to
// understand the engine. config.ts / typereg.ts / prompts.ts feed it; worker/index.ts just wires it up.

export { Engine, type EngineDeps } from "./loop.js"
export { configFromEnv, type EngineConfig } from "./config.js"
export { TypeRegistry, type ChecklistEntry, type ReviewSpec, type TypeContract } from "./typereg.js"
