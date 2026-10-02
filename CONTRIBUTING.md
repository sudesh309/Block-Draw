# Contributing to Block Draw

Issues and pull requests are welcome.

## Setup

```bash
npm install
npm run dev   # rebuilds main.js on change; load the vault it's symlinked/copied into and reload Obsidian
```

See the [Development](docs/DESIGN.md#development) section of the design doc for the full list of
scripts (lint, unit tests, editor UI tests, end-to-end tests in real Obsidian), and its
[Architecture](docs/DESIGN.md#architecture) section for how the code is laid out.

## Before opening a pull request

```bash
npm run lint
npm test
npm run build
```

Please keep changes focused and add or update tests for behavior you change. For anything beyond a
small fix, feel free to open an issue first to discuss the approach.

## Reporting a bug

Include your Obsidian version, platform (desktop/mobile, OS), and the steps to reproduce. If it's
related to Google Sheets export, note which connection method you're using (Apps Script web app or
Google account) — never include your Apps Script secret, OAuth client secret or any access/refresh
token.

## Security

Please report security issues privately via a [GitHub security advisory](https://github.com/sudesh309/Template-Generator/security/advisories/new) rather than a public issue.
