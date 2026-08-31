# @lumine/dsh-token-saver

Lumine Token Saver is a durable four-level dial for DeepSeek Harness:

- `off` disables the doctrine and leaves host subagent options unchanged.
- `light` is the default and adds a short context-conservation reminder.
- `balanced` adds compressed graph-first planning doctrine and routes newly spawned host subagents to low effort.
- `aggressive` adds `SUB-BREAK` guidance on top of Balanced.

The selected level is stored at `$DSH_HOME/.lumine-token-saver.json` as `{ "level": "..." }`; the file wins over defaults. Balanced and Aggressive only route new host subagent spawns, never live sessions. Doctrine is added to the native session system prompt. `/token-saver` shows or sets the dial for ACP sessions (Settings also hosts the four-button control). RPC: `tokenSaver.get` / `tokenSaver.set`.
