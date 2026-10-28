import { defineConfig } from "vitest/config"

// Only the TypeScript sources are tests. `tsc -b` emits compiled *.test.js into each package's dist/,
// and vitest would otherwise run those too (every test twice) — so exclude dist/ (and node_modules).
export default defineConfig({
	test: {
		include: ["**/src/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**"],
	},
})
