# ADR 0004: Secrets stay on the device

**Status:** accepted (0.5.0)

## Context

Up to 0.4.6 the Apps Script secret and the OAuth client secret were saved in the plugin's `data.json`, in plain text, inside the vault. Anything that copies the vault (sync, backups, a shared folder, git) copied the secrets too. The Google sign-in tokens were already kept on the device.

## Decision

- A setting row marked `type: "secret"` is never written to `data.json`. It lives in Obsidian's secret storage (1.11.4 and later), or else in this vault's local storage on this device. The names are prefixed with `block-draw-` and a hash of the vault name, so two vaults on one device keep separate secrets.
- On the first load of 0.5.0, a secret found in `data.json` is copied into the device's store and `data.json` is saved again without it. For one release, a secret that is in `data.json` but not in the store is still read and moved, so other devices pick it up if they load first.
- If a device cannot store a secret, it stays in `data.json` and the settings tab says so, rather than losing it.

## Consequences

- Secrets no longer sync between devices: enter them once on each device. The settings tab says this next to each secret.
- The Google sign-in tokens and the settings secrets share one storage helper (`obsidian/secrets.ts`).
- 0.6.0 can drop the `data.json` fallback.
