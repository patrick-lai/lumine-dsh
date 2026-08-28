# @lumine/dsh-acp-session

DeepSeek Harness **Agent factory** so a web session is Claude Code, Codex, Cursor, or Grok Build over official ACP CLIs. The bundle also pins the in-page browse workspace picker and disables official DeepSeek key onboarding. See the [repository README](../../README.md) for TOS stance, install, and the verified seams.

This package declares `dsh.bundle` so `dsh plugin add` loads it. Without that field it would install as a plain dependency and never mount.
