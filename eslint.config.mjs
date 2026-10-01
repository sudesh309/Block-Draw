import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	{
		ignores: ["main.js", "node_modules/**", "tests/**", "*.mjs", "vitest.config.mts", "apps-script/**"],
	},
	...obsidianmd.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.*"],
				},
			},
		},
		rules: {
			"obsidianmd/ui/sentence-case": [
				"warn",
				{
					brands: ["Google Sheets", "Google Cloud", "Google", "Apps Script", "Excel", "Block Draw", "OAuth", "Space", "Shift", "Alt"],
					acronyms: ["JSON", "SVG", "PNG", "URL", "API", "ID"],
					ignoreRegex: ["^https?://"],
				},
			],
			// The settings tab supports Obsidian versions before 1.13 and has dynamic parts
			// (buttons, conditional sections) that the declarative settings API cannot express.
			"obsidianmd/settings-tab/prefer-setting-definitions": "off",
		},
	},
	{
		// The editor and renderer are Obsidian-independent (they also run in the browser test
		// harness and in Node), so they use standard DOM APIs instead of Obsidian's helpers.
		files: ["src/editor/**/*.ts", "src/render/**/*.ts", "src/model/**/*.ts", "src/geometry/**/*.ts", "src/export/**/*.ts"],
		rules: {
			"obsidianmd/prefer-create-el": "off",
		},
	},
]);
