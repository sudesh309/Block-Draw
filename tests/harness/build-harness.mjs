// Bundles the editor harness into tests/harness/dist for Playwright UI tests.
import esbuild from "esbuild";
import { copyFileSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist");
mkdirSync(out, { recursive: true });

await esbuild.build({
	entryPoints: [join(here, "harness.ts")],
	bundle: true,
	format: "iife",
	target: "es2020",
	outfile: join(out, "harness.js"),
	sourcemap: "inline",
	logLevel: "warning",
});

copyFileSync(join(here, "..", "..", "styles.css"), join(out, "styles.css"));
writeFileSync(
	join(out, "index.html"),
	`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Block Draw harness</title>
<link rel="stylesheet" href="styles.css">
<style>
	html, body { margin: 0; height: 100%; font-family: -apple-system, "Segoe UI", sans-serif; }
	body.theme-dark { --background-primary: #1e1e1e; --text-normal: #dcddde; --text-muted: #999; --text-faint: #666;
		--background-modifier-border: #333; --background-modifier-hover: rgba(255,255,255,.07); --interactive-accent: #7f6df2; }
	#app { position: absolute; inset: 0; }
	.harness-menu { position: fixed; z-index: 100; background: #fff; border: 1px solid #ccc; border-radius: 6px; padding: 4px 0;
		font-size: 13px; box-shadow: 0 4px 16px rgba(0,0,0,.15); min-width: 180px; }
	.harness-menu-item { padding: 4px 12px; cursor: pointer; }
	.harness-menu-item:hover { background: #eef; }
	.harness-menu hr { margin: 4px 0; border: none; border-top: 1px solid #eee; }
</style>
</head>
<body>
<div id="app"></div>
<script src="harness.js"></script>
</body>
</html>
`,
);
process.stdout.write(`harness built: ${join(out, "index.html")}\n`);
