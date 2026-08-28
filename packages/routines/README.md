# @lumine/dsh-routines

Host-owned **durable routines** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). A routine survives process restart and fires even when no chat is open.

This is **not** `@deepseek-ai/dsh-schedule`. That official package stays mounted: it is session-local reminders (`after` / `at` / `every_seconds`) that deliver inside a live conversation. Routines sit beside it.

See the [repository README](../../README.md) for install, TOS stance, and the verified DSH seams.

`link:` installs need `@deepseek-ai/cordis` resolvable from this package directory. The entrypoint links peers from `$DSH_HOME/profiles/.../node_modules` before loading the plugin; `node scripts/ensure-dsh-peers.mjs` does the same by hand.

This package declares `dsh.bundle` so `dsh plugin add` loads it.

## Create a routine

RPC (same shape as DSH `goal.*`):

- `routine.create` `{ title, promptTemplate, rule, mode?, timezone?, quietHours?, window?, maxRuns? }`
- `routine.list` / `routine.update` / `routine.delete` / `routine.enable` / `routine.runNow`

Slash command when `dsh-commands` is composed:

```
/routine create morning-triage -- Review the inbox and write a 5-line brief.
/routine list
/routine run <id>
```

`rule` is `cron` (`0 9 * * 1-5`), `interval` (seconds), `once`, or `manual` (run-now only). `mode` is `cron` (spawn + one prompt) or `grind` (same spawn, then a v1 hidden-continue loop with a ceiling). Delivery uses `agents.create` with the `grok-build` preset and the shared workspace checkout. It never steals an already-open operator session.

State lives in `ctx.storageDomain` when that service exists, otherwise `$DSH_HOME/lumine-routines/routines.json`. It is never written to a session event log.
