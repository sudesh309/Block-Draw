# Architecture decision records

One page per decision that shapes the code: the context, the decision, and what follows from it. Add the next number for a new decision; change an old record only to mark it replaced.

| ADR | Decision |
| --- | --- |
| [0001](0001-the-file-is-the-abi.md) | The `.blockdraw` file and the exports are the public interface, guarded by golden files |
| [0002](0002-tables-over-switches.md) | One table with one row per variant, instead of switch statements spread over files |
| [0003](0003-no-public-driver-api-yet.md) | The tables stay internal until a second consumer exists |
| [0004](0004-secrets-stay-on-the-device.md) | Secrets live in the device's secret storage, never in the synced settings file |
| [0005](0005-one-door-to-the-network.md) | One gateway for every request, and links that cannot start programs |
