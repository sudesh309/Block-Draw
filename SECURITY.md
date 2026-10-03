# Security

## Reporting a problem

Please report a vulnerability privately, through the **Report a vulnerability** button on this repository's **Security** tab. If you do not see it, open an issue that only says you have something to report, without details, and the maintainer will get in touch.

Only the latest release gets fixes.

## What Block Draw can reach

Obsidian plugins run with your full rights, so this is what the code allows, kept in one place and checked when it is built (see [ADR 0005](docs/adr/0005-one-door-to-the-network.md)):

- **Network.** Every request goes through `src/obsidian/net.ts`, over https only, to these hosts:
  - `fonts.googleapis.com` and `fonts.gstatic.com`, only while **Load web fonts from Google Fonts** is on (off by default);
  - `sheets.googleapis.com`, `oauth2.googleapis.com` and your Apps Script web app on `script.google.com`, only when you export to Google Sheets or test that connection. An Apps Script address on another domain is used only after you confirm it.

  Nothing else is contacted: no telemetry, no update checks.
- **Files.** Drawings you open, and the files you export (into the export folder from the settings, or next to the drawing).
- **Secrets.** The Apps Script secret, the OAuth client secret and the Google sign-in are kept on each device (Obsidian's secret storage, or this vault's local storage), never in the synced settings file (see [ADR 0004](docs/adr/0004-secrets-stay-on-the-device.md)).
- **Links.** A link in a drawing opens only if it is a web or mail link; `obsidian://` links ask first, and other kinds are refused.

## Supply chain

One runtime dependency (`fflate`). Releases contain exactly `main.js`, `manifest.json` and `styles.css`, built by the release workflow from a tagged commit with GitHub's build provenance attestations. The workflows pin every action to a commit, CI audits the runtime dependencies, and Dependabot proposes updates.
