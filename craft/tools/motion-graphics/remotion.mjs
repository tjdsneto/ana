#!/usr/bin/env node
// remotion adapter — RESERVED. Remotion renders a React composition (not raw HTML), so this backend
// needs a scaffold that embeds the caller's composition + a tested render path. Not implemented yet;
// the dispatcher + hyperframes backend ship first. Set MOTION_GFX_BACKEND=hyperframes (the default).
//
// When built: install @remotion/renderer + @remotion/cli (via ./x), scaffold a minimal composition
// that mounts the HTML (or port the GSAP timeline to a Remotion <Series>), render with the CLI, and
// bake Chromium into the engine image's engine-tools stage (same lib set HyperFrames needs).
export async function render() {
	throw new Error(
		"motion-graphics: the remotion backend is not implemented yet — use MOTION_GFX_BACKEND=hyperframes (default)",
	)
}

if (import.meta.url === `file://${process.argv[1]}`) {
	render().catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1) })
}
