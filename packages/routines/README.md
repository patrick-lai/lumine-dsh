# @lumine/dsh-routines

Host-owned **durable routines** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). A routine survives process restart and fires even when no chat is open.

This is **not** `@deepseek-ai/dsh-schedule`. That official package stays mounted for same-session reminders. A routine fire is a new DSH session; after fire, `schedule_list` on the authoring session is still empty.

There is no `/routine` slash.

See the [repository README](../../README.md) for install, TOS stance, and the verified DSH seams.

`link:` installs need `@deepseek-ai/cordis` resolvable from this package directory. The entrypoint links peers from `$DSH_HOME/profiles/.../node_modules` before loading the plugin; `node scripts/ensure-dsh-peers.mjs` does the same by hand.

This package declares `dsh.bundle` so `dsh plugin add` loads it.

## Model tools

Exactly these five. Never `schedule_*`. Never `schedule/change`. `routine_enable` is not a model tool.

- `routine_list`
- `routine_create` — always lands `enabled: false`
- `routine_update` — always leaves the row paused
- `routine_delete`
- `routine_run_now` — refuses a paused row

Operator arm is host RPC `routine.enable` / settings only.

`rule` (clock) is `once`, `interval` (seconds), five-field `cron`, or `manual`. Quiet hours are IANA; wrapping night arcs are allowed. Catch-up is one fire plus a missed-count note, never a backfill storm.

Delivery calls `agents.create` on the already-registered factory. The first user message is the rendered `promptTemplate`. `routineId` is stamped on `request/context` — DSH persistence rejects unknown event types.

State lives in `ctx.storageDomain` when that service exists, otherwise `$DSH_HOME/lumine-routines/routines.json` at mode `0600`. The tick is `ctx.interval(30000)` via the existing cordis timer plugin.
