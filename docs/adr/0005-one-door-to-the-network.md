# ADR 0005: One door to the network, and links that cannot start programs

**Status:** accepted (0.5.0)

## Context

Obsidian plugins run with the user's full rights, so nothing technical stops a plugin from talking to any server or starting any program. Up to 0.4.6 Block Draw only contacted Google (fonts when the setting was on, Sheets when exporting), but three modules called `requestUrl` directly, nothing enforced a host list, and a link stored in a drawing was handed to the operating system whatever its scheme.

## Decision

- `obsidian/net.ts` is the only place that calls `requestUrl`. The layer check (`scripts/check-layers.mjs`) fails the build otherwise.
- Every request must be https and go to an allowed host. The allow-list is built from what the tables declare in `needs`: the hosts of every exporter, and a setting's hosts only while that setting is on. Turning off "Load web fonts" therefore also closes the door to Google Fonts.
- An Apps Script address outside `script.google.com` is used only after the person confirms it, once per session, since the drawing and the secret are sent there.
- A link from a drawing opens only if it is `http`, `https` or `mailto`. An `obsidian://` link opens after a confirmation that shows it. Every other scheme is refused with a notice. The link is still kept in the file as written.
- The spreadsheet address in a Google Sheets reply is opened only if it is on `docs.google.com`.

## Consequences

- What the plugin can reach is listed in one place, the `needs` of the table rows, and reviewing a new exporter means reading its row.
- This is review hygiene, not a sandbox: the plugin could still bypass it, and the build check is what keeps the rule.
- Font files stay lazy: the browser downloads them only when text uses them, and the stylesheet parser accepts only `https://fonts.gstatic.com` sources.
