// The community directory's review scans styles.css the same way: no `!important`, and no CSS feature that
// the Chromium of the oldest supported Obsidian (1.5, Electron 25 = Chrome 114) lacks or only partly supports.
export default {
	plugins: ["stylelint-no-unsupported-browser-features"],
	rules: {
		"declaration-no-important": true,
		"plugin/no-unsupported-browser-features": [true, { browsers: ["Chrome 114"], severity: "warning" }],
	},
};
