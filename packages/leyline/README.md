# @lumine/dsh-leyline

DeepSeek Harness **host adapter** for an already-running [Leyline](https://github.com/patrick-lai-2/leyline-agent-memory) memory daemon. Lumine does not embed the store. DSH has no `MemorySource` and no cross-session memory; this plugin is that seam.

Keyword for discovery: `dsh-plugin`.

## Point DSH at a running daemon

The daemon is a separate process. Default bind is `http://127.0.0.1:6868`. Start Leyline yourself, then load this plugin (the root `lumine-dsh` bundle already inserts it):

```yaml
- id: lumine-leyline
  config:
    baseUrl: http://127.0.0.1:6868
    materialize: false          # opt-in write of <git-root>/.leyline/LESSONS.md
    maxMemories: 4
    maxTokens: 1200
```

This plugin **never starts the daemon**, never scrapes tokens, and never writes API keys.

## Fire-and-forget

A memory miss must never fail `session.create` or `session.prompt`. Capability probe, context-pack, session-events, lifecycle, and materialize are all best-effort. If the daemon is down the plugin stays silent and healthy (standalone no-op).

Features are probed on `GET /v1/dashboard/snapshot` (`capabilities.contract` + `capabilities.features`). Missing feature = degrade. The plugin never version-sniffs a daemon string.

## What it does

1. **Capability probe** on boot / first use. Cache features.
2. **Context-pack** on session start or first prompt: `POST /v1/context-pack` with workspace/repo scope and a budget (`max_memories` ~4, `max_tokens` ~1200).
3. **Settlement** on session end: one append-only `POST /v1/session/events` with key `lumine-dsh-settle-<session>`. Bounded digest + tail, secrets scrubbed on the host. Receipt rides `extensions.dsh.receipt` (and `extensions.lumine.receipt`). `source_client_id` is `lumine-dsh`, not `raphael`.
4. **Lifecycle** when DSH emits workspace-removed / worktree-deleted: `POST /v1/lifecycle`. Non-destructive.
5. **materialize** of `.leyline/LESSONS.md`: config flag, **default OFF**. Absolute existing git workspace roots only.

v1 does not include vault fallback, dreams, gardens, hygiene judge, or a Memory-stage UI.

## ACP injection degrade

This bundle replaces DSH's agent-loop with `@lumine/dsh-acp-session`. The official ACP child owns tools. DSH `ctx.systemPrompt` and `agent/pre-step` inbox splices are agent-loop seams — they do not reach the child, and this plugin does **not** invent a second loop or a user bubble.

If you need the child to inherit recall from disk, set `materialize: true`. Otherwise events are still captured; compiled recall stays host-side for the settlement receipt.

## Install

The root bundle already inserts this plugin. One package only:

```sh
dsh plugin --profile web add link:/absolute/path/to/lumine-dsh/packages/leyline
```

`link:` installs need `@deepseek-ai/cordis` resolvable from this package directory. The entry runs `ensureDshPeers()` (honors `DSH_HOME` / `DSH_PROFILE`) before importing the plugin; you can also run `node packages/leyline/scripts/ensure-dsh-peers.mjs`.

## What this is not

- Not a fork of DeepSeek Harness.
- Not a Rust port of `leyline-agent-memory`.
- Not a second DSH session log (persistence refuses unknown event types).
- Not SwiftUI / Memory-stage UI.
