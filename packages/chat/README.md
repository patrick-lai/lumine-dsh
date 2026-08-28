# @lumine/dsh-chat

DeepSeek Harness chat that behaves like Lumine inbuilt chat.

Stock DSH renders every `tool-call` as its own transcript row. An ACP child (Grok Build, Claude Code, Codex, Cursor) emits dozens of `read_file` / `grep` / `search_tool` calls per turn, so the web transcript fills with a hundred generic "Tool call · …" lines.

This plugin replaces the `conversation.chat.node` renderer for `tool-call`:

- Consecutive tool calls fold into **one collapsed activity strip** (Lumine `ToolGroup`).
- A run of one stays a normal tool row.
- The collapsed face names the live step verb-first (`Read path`, `Search pattern`) instead of `Tool call · read_file · …`.
- Expanding the strip lists each member as a compact verb + target row.

Host `apply` is a no-op. The browser half ships as `dsh.client`. The root lumine-dsh bundle inserts this plugin after the ACP factory so it loads later than stock `ui-tool` and takes over that keyed seat.
