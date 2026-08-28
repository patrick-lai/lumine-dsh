# @lumine/dsh-goal-completion

The deferred DSH completion policy layer: a worker `update_goal` complete (or an ACP `GOAL REACHED` marker) is only a candidate until an isolated read-only judge outputs `GOAL COMPLETION VERDICT: APPROVED - …`. Human `/goal` and RPC `goal.complete` stay operator-authoritative.

ACP marker harvest + hidden continue nudges mount **instead of** `dsh-goal-round-driver` on lumine ACP sessions (`claude-code`, `codex`, `cursor`, `grok-build`). The host overlay disables the stock dsh-base driver so dump-config shows it unmounted; the presets disable it too. Marker harvest never installs on DeepSeek-native sessions. A one-by-one install of this package alone does not disable the native driver.

See the [repository README](../../README.md) for install. `link:` installs need DSH peers resolvable from this package directory; the entrypoint links them from `$DSH_HOME/profiles/.../node_modules`.
