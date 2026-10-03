import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: { obsidian: fileURLToPath(new URL("./tests/fakes/obsidian.ts", import.meta.url)) },
	},
	plugins: [
		{
			// The settings tab imports the Apps Script bridge as text, as esbuild's ".gs" loader does in the build.
			name: "apps-script-as-text",
			transform: (code, id) => (id.endsWith(".gs") ? { code: `export default ${JSON.stringify(code)};`, map: null } : null),
		},
	],
	test: {
		include: ["tests/**/*.test.ts"],
		environment: "node",
	},
});
