# @lumine/dsh-acp-session

DeepSeek Harness **Agent factory** so a web session is Claude Code, Codex, Cursor, or Grok Build over official ACP CLIs. The bundle also pins the in-page browse workspace picker and disables official DeepSeek key onboarding. See the [repository README](../../README.md) for TOS stance, install, and the verified seams.

The composer model picker reads host `session.models`. This package starts the official ACP child at session create (NDJSON, no authenticate unless required), projects the child's advertised models — Grok Build 1.0.5: `models`/`modelState` plus `_meta.x.ai/sessionConfig.options` (Grok 4.6 / 4.5, mode xhigh/high/medium/low) — into a catalog-only adapter, appends `model/selection`, and maps `session.selectModel` onto `session/set_config_option` using those option ids. Generation stays on the child.

This package declares `dsh.bundle` so `dsh plugin add` loads it. Without that field it would install as a plain dependency and never mount.
