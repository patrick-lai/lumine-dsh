# @lumine/dsh-skills

DeepSeek Harness plugin that installs Lumine's bundled skills into
`$DSH_HOME/skills` and registers `/review`, `/wayfinder`, `/pr-warden`, and
`/second-opinion` as direct command launchers.

The package overlay is `./cordis.patch.yml`. Applying the plugin refreshes the
five package-owned skill directories while leaving unrelated user skills alone.

Leyline MCP (`leyline serve --stdio` via `@deepseek-ai/dsh-mcp-client`) is a
root-bundle row, not this package overlay. ACP children see a skill when the
operator runs the matching slash command (host followup).
