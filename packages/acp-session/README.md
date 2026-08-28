# @lumine/dsh-acp-session

DeepSeek Harness **Agent factory** so a web session is Claude Code, Codex, Cursor, or Grok Build over official ACP CLIs. The root lumine-dsh bundle also pins the in-page browse workspace picker. See the [repository README](../../README.md) for TOS stance, install, and the verified seams.

The composer model picker reads host `session.models`. This package registers a catalog-only adapter from plugin `apply` (`grok` / `claude` / `codex` / `cursor`; Grok seeded with live 1.0.5 gold grok-4.6 / grok-4.5). The adapter implements `providerRetryPolicy` / `imageRequestPricing` / `prepareCall` so `LlmRuntime.prepareRoutes` can register the routes; a missing `providerRetryPolicy` was a TypeError and `listProviders()` never contained `grok`. Seed fails loud if `listProviders()` still lacks those ids. `model/selection` is written in the Agent constructor — before host `setup` freezes `selectionFor().current` on `deepseek-official`. `agentDefaultModel` is read only via `ctx.get` (property access throws without inject). `request/header` is written only after `listProviders()` serves that product. The official ACP child still starts at session create (NDJSON, no authenticate unless required) and refreshes that catalog from `models` / `modelState` / `_meta.x.ai/sessionConfig.options`. `session.selectModel` maps onto `session/set_config_option`. Generation stays on the child; `stream()` throws.

Each prompt follows the host loop order: `turn/start` first, then `Inbox.claim`. Kick/turn failures are `logger.error` with stack (never an empty `catch`). Inbox `inserted` wakes the driver so a host splice still starts a turn.

Do not disable `llm-deepseek` as an onboarding skip (empty `apiKeyEnv` already skips the key gate). Do not re-insert `directory-picker-browse` in a profile overlay if the root bundle already did.

`link:` installs need `@deepseek-ai/cordis` (and the other DSH peers) resolvable from this package directory. The entrypoint links them from `$DSH_HOME/profiles/.../node_modules` before loading the plugin; `node scripts/ensure-dsh-peers.mjs` does the same by hand.

This package declares `dsh.bundle` so `dsh plugin add` loads it. Without that field it would install as a plain dependency and never mount.
