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
					brands: ["Google Sheets", "Google Cloud", "Google Fonts", "Google", "Apps Script", "Excel", "Block Draw", "OAuth", "Space", "Shift", "Alt"],
					acronyms: ["JSON", "SVG", "PNG", "URL", "API", "ID"],
					ignoreRegex: ["^https?://"],
				},
			],
			// The settings tab supports Obsidian versions before 1.13 and has dynamic parts
			// (buttons, conditional sections) that the declarative settings API cannot express.
			"obsidianmd/settings-tab/prefer-setting-definitions": "off",
		},
	},
]);
