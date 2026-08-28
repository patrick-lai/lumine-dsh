# @lumine/dsh-acp-session

DeepSeek Harness **Agent factory** so a web session is Claude Code, Codex, Cursor, or Grok Build over official ACP CLIs. The bundle also pins the in-page browse workspace picker and disables official DeepSeek key onboarding. See the [repository README](../../README.md) for TOS stance, install, and the verified seams.

The composer model picker reads host `session.models`. This package starts the official ACP child at session create, projects that product's `configOptions` into a catalog-only LLM adapter (generation stays on the child), appends `model/selection`, and maps `session.selectModel` to `session/set_config_option`.

This package declares `dsh.bundle` so `dsh plugin add` loads it. Without that field it would install as a plain dependency and never mount.
