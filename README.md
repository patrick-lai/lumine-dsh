# lumine-dsh

Lumine capabilities as [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugins. This repository is the install home: `dsh plugin --profile web add github:patrick-lai/lumine-dsh` gets everything. Packages inside can also be installed one-by-one later.

**Today that is four plugins:**

- `@lumine/dsh-acp-session` — an ACP session factory so a DSH web session *is* Claude Code, Codex, Cursor, or Grok Build, using the official CLI you already logged into.
- `@lumine/dsh-goal-completion` — the deferred DSH completion policy layer. A worker `update_goal` complete (or an ACP `GOAL REACHED` marker) is only a candidate until an isolated judge outputs `GOAL COMPLETION VERDICT: APPROVED`. Human `/goal` and RPC `goal.complete` stay operator-authoritative. This bundle disables host-plane `goal-round-driver` (the stock dsh-base row) so `dsh --dump-config` shows it absent from the mounted set; marker harvest owns continue on lumine ACP presets.
- `@lumine/dsh-routines` — host-owned durable automations (calendar cron/interval, quiet hours, overlap guard, catch-up-once). The model can create paused rows only; an operator arms them. They sit **beside** official `@deepseek-ai/dsh-schedule`, which stays mounted as session-local reminders.
- `@lumine/dsh-chat` — Lumine inbuilt-chat transcript. Consecutive ACP tool calls fold into one collapsed activity strip instead of a hundred generic "Tool call · read_file · …" rows.

Keyword for discovery: `dsh-plugin`.

## TOS stance

We never scrape Keychain / `auth.json` tokens and never hit unofficial backends (`chatgpt.com/backend-api`, etc.).

The session **spawns the official product process**. Usage bills the subscription already attached to that CLI:

| Product | You install and log in | We spawn |
|---|---|---|
| Claude Code | `claude` (Pro/Max) | `npx -y @agentclientprotocol/claude-agent-acp` with `CLAUDE_CODE_EXECUTABLE` |
| Codex | `codex login` (ChatGPT) | `npx -y @agentclientprotocol/codex-acp` with `CODEX_PATH` |
| Cursor | `cursor-agent login` | `cursor-agent acp` |
| Grok Build | `grok login` | `grok agent --always-approve stdio` |

No API keys. `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `XAI_API_KEY` are not injected. Claude's adapter has `ANTHROPIC_API_KEY` unset so the Pro/Max login wins. We do not depend on V1ki/dsh-plugin-subscriptions or any token-scraping plugin.

## The DSH seam (verified, not guessed)

DSH's default `@deepseek-ai/dsh-agent-loop` is the host-plane **Agent factory**. `ctx.agents.setFactory()` is a unary slot and throws if a factory is already registered. Presets cannot publish host-plane services. An LLM adapter would still run DSH's tool loop. `@deepseek-ai/dsh-subagent-acp` is a one-shot *child* that returns only final text and does **not** put intermediate traffic in the parent log.

So this plugin **replaces the Agent factory** and pins the in-page workspace picker:

```yaml
- id: agent-loop
  disabled: true
- id: goal-round-driver
  disabled: true
- insert:
    - id: lumine-acp-session
      name: '@lumine/dsh-acp-session'
    - id: lumine-goal-completion
      name: '@lumine/dsh-goal-completion'
    - id: lumine-routines
      name: '@lumine/dsh-routines'
    - id: lumine-chat
      name: '@lumine/dsh-chat'
- id: directory-picker
  name: '@deepseek-ai/dsh-host-directory-picker-auto'
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: ui-directory-picker-browse
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
```

`directory-picker-auto` picks the native macOS dialog on darwin. A detached `dsh` never shows that dialog, so "+ Add workspace" looks dead. The seam is disable+insert of browse (same-id name rewrite is not how later layers swap this row). Clicking an existing workspace still uses `onPick`. **Do not copy those browse rows into the profile `cordis.patch.yml`** if this bundle already inserted them — a second insert is a duplicate loader id. The package-only overlay (`packages/acp-session/cordis.patch.yml`) therefore inserts the factory only.

ACP sessions do not need a DeepSeek API key. Empty `apiKeyEnv` already skips the official key gate. **Do not disable `llm-deepseek` as an onboarding skip.** That left `session.models.current` on `deepseek-official` / `deepseek-v4-flash` while nothing served that route (`groups: []`, `session.prompt` → `model-unavailable`). We do not write a fake `DEEPSEEK_API_KEY` and we do not touch `.credentials.yaml`.

Community pattern: `dsh-loop-dock`. v1 is an ACP-only profile (DeepSeek-native sessions in the same process would register as a loop-dock driver later).

Creation copies DSH's transaction: `sessions.prepare` → construct Agent → `setup(agentCtx)` → start the official ACP child → `sessions.enter` → disposer → `sessions.announce` → `agents.enter` → `agents.announce` → `agent/session-start`.

The web composer picker reads host-wide `session.models` (`ctx.llm.listProviders` / `listModels`) plus `selectionFor(agent).current`. That current is an in-process `selectModel` pick, else `session.requestHeader()?.config`, else settings `agent-default-model` (DeepSeek, or whichever product last called `saveSelection` — often grok-4.6). Host `session.create` also stuffs that global default into `agentOptions.provider`. The host catalog is every registered route, so without a gate the composer would list DeepSeek plus Claude/Codex/Cursor/Grok and grey out (or `model-unavailable`) everything the selected ACP child cannot serve. We wrap `session.models` / `session.selectModel` so the rows are only that session's product (Claude Code → `default` / opus / sonnet / haiku, Grok → grok-4.6 / grok-4.5, …); a foreign pick is `model-unavailable`. Swapping the top-left agent applies that product's last-used model (durable per product in `$DSH_HOME/.lumine-acp-session/last-models.json`) or its catalog default — host `agent-default-model` is one global slot and cannot remember Claude and Grok separately. Host `setup` calls `selectionFor` *before* the ACP child is spawned, and `request/header` is turn-enclosed, so this plugin:

1. Registers a **catalog-only** adapter from plugin `apply` for `claude` / `codex` / `cursor` / `grok` (Grok seeded with live 1.0.5 gold: grok-4.6 / grok-4.5; Claude Code with live ACP 0.70 `default` / `opus[1m]` / `sonnet` / `haiku`). The adapter implements the host `LlmAdapter` surface `registerAdapter` actually calls (`providerRetryPolicy` → `undefined`, `imageRequestPricing` → `undefined`, `prepareCall`). `stream()` throws; generation stays on the official child. After seed, `listProviders()` must contain those ids or we `logger.error` and throw — a missing `providerRetryPolicy` was a TypeError that we used to swallow, leaving `groups` DeepSeek-only and `routable: false`.
2. Resolves the official child from **`session.header.agentPreset` first**. The host-wide default in `agentOptions.provider` must not turn a Claude Code / Codex / Cursor session into Grok.
3. Wraps `session.requestHeader()` so `selectionFor().current` is this product before the first prompt. We do **not** append `model/selection` — DSH does not read that event, and it is missing from `KNOWN_SESSION_EVENT_TYPES` (resume would refuse the log).
4. Best-effort `agentDefaultModel.saveSelection` so a later session *without* a preset is not DeepSeek. Per-session current does not depend on that write.
5. Writes `request/header` only when that provider is already on `listProviders()`. The live second-prompt miss wrote `{ provider: grok, model: deepseek-v4-flash }` (`agentOptions.model` is the host default). `selectionFor()` then preferred that header and refused `session.prompt` with `no adapter serves provider "grok"`.

`session.selectModel` calls `ctx.llm.resolveCallConfig` then maps onto ACP `session/set_config_option` using the child's option ids (Grok: `grok-4.6` / `grok-4.5` and mode `high`). Authenticate is not called unless the child requires it — Grok's `_meta.defaultAuthMethodId` is `cached_token`; we do not scrape `~/.grok/auth.json`.

The Web UI picker is **agent presets**. On load we copy four presets into `$DSH_HOME/.agent-presets` (`claude-code`, `codex`, `cursor`, `grok-build`). Those compositions mount **no** DSH bash/fs/web tools — the child owns tools.

The official child starts when the session is created (not on the first send) so the picker already has that product's models. Each user message is ACP `session/prompt`. The driver matches official loop order: append `turn/start`, then `Inbox.claim`. Kick/turn failures are logged with stack (`agent/error`); an empty `catch` hid the live NaN-turn miss (`phase.lastTurn` on a running phase). Inbox `inserted` also wakes the driver. `session/update` folds into DSH's append-only session log (`turn/start`, `user/message`, `assistant/chunk`, `tool/call`, `tool/result`, `assistant/message`, `turn/end`). Cancel is `session/cancel`. One long-lived CLI child per DSH session (`session/load` on resume). The official ACP session id is stored on the synthetic `request/context` row (`acpSessionId`) — DSH persistence refuses unknown event types on load, so a custom `lumine-acp/bound` type would break resume after restart.

## Install

Requires the `dsh` CLI. From a machine that already has Claude / Codex / Cursor / Grok logged in:

```sh
dsh plugin --profile web add github:patrick-lai/lumine-dsh
```

pnpm ≥ 10 refuses a git dependency's `prepare` until you allow it. The first `add` may fail and print the exact package key; put it in the profile `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  lumine-dsh: true
```

and re-run the `add`. `prepare` runs [tsdown](https://github.com/voidzero-dev/tsdown) so git installs get built entrypoints without a sibling DSH checkout.

Local checkout:

```sh
dsh plugin --profile web add link:/absolute/path/to/lumine-dsh
```

A `link:` install loads `@lumine/dsh-acp-session`, `@lumine/dsh-goal-completion`, `@lumine/dsh-routines`, and `@lumine/dsh-chat` from their real paths. Node will not see `@deepseek-ai/cordis` in the profile `node_modules` unless those peers are linked into each package `node_modules`. Each package entry runs `ensureDshPeers()` (honors `DSH_HOME` / `DSH_PROFILE`) before importing the plugin; you can also run `node packages/acp-session/scripts/ensure-dsh-peers.mjs`, `node packages/goal-completion/scripts/ensure-dsh-peers.mjs`, or `node packages/routines/scripts/ensure-dsh-peers.mjs`.

One package only:

```sh
dsh plugin --profile web add link:/absolute/path/to/lumine-dsh/packages/acp-session
dsh plugin --profile web add link:/absolute/path/to/lumine-dsh/packages/goal-completion
dsh plugin --profile web add link:/absolute/path/to/lumine-dsh/packages/routines
dsh plugin --profile web add link:/absolute/path/to/lumine-dsh/packages/chat
```

Then `dsh --profile web`. New session → pick **Claude Code**, **Codex**, **Cursor**, or **Grok Build**.

## Routines

`@lumine/dsh-routines` is a host-plane store. A routine survives process restart and fires even when no chat is open. It is **not** `@deepseek-ai/dsh-schedule`. That official package stays mounted for same-session reminders (`schedule_list` / `schedule_create`). A routine fire is a **new** DSH session; the authoring session must still have an empty schedule fold.

There is no `/routine` slash. Command palette in Lumine only opens a stage; DSH does not need that chrome.

Model tools (never `schedule_*`, never `schedule/change`):

- `routine_list`
- `routine_create` — always persists `enabled: false`
- `routine_update` — always persists `enabled: false`
- `routine_delete`
- `routine_run_now` — refuses a paused row

`routine/enable` is host RPC / the left-rail **Routines** pane only (`TypertRemoteService` namespace `routine`). The model cannot arm unattended work. The pane lists persisted rows and edits title, prompt, cron/interval/once/manual, IANA timezone, quiet hours, and max runs. Enable, pause, run now (refuses while paused), and delete are operator-only. Create lands paused. The client half lives on the same `@lumine/dsh-routines` package (`dsh.client`) as a `sidebar.footer.action`, so the rail control appears without editing the profile `cordis.patch.yml`.

Clock: `once` | `interval(seconds)` | five-field cron | `manual`. Quiet hours are IANA (wrapping night arcs ok). Catch-up is one fire plus a missed-count note. Failed delivery retries up to 3 ticks, then advances.

Fire calls the already-registered Agent factory (`lumine-acp-session` or the stock loop). The first user message is the rendered prompt (`{{KEY}}` / `${KEY}` plus `SCHEDULE_ID`, `SCHEDULE_TITLE`, `NOW_ISO`). `routineId` is stamped on `request/context`.

State lives in `ctx.storageDomain` when that service exists, otherwise `$DSH_HOME/lumine-routines/routines.json` at mode `0600`. The tick is `ctx.interval(30000)` via the existing cordis timer plugin.

The package-only overlay (`packages/routines/cordis.patch.yml`) inserts this plugin only. It does not disable `agent-loop` (ACP session already does) and it does not re-insert `directory-picker-browse`.

## CLI prerequisites

Command paths are configurable. Defaults follow PATH, plus `~/.local/bin` and `~/.grok/bin`.

**Cursor is `cursor-agent`, not `agent`.** On some machines (including the author's) `agent` on PATH is Grok Build.

| Provider | Default launch | Login | Docs |
|---|---|---|---|
| Grok Build | `grok agent --always-approve stdio` (flags after `agent`, before `stdio`) | `grok login` / SuperGrok / X Premium+ | https://github.com/xai-org/grok-build |
| Cursor | `cursor-agent acp` | `cursor-agent login` / ACP `cursor_login` | https://cursor.com/docs/cli/acp |
| Claude Code | `npx -y @agentclientprotocol/claude-agent-acp` | existing `claude` login; `CLAUDE_CODE_EXECUTABLE` | official ACP adapter |
| Codex | `npx -y @agentclientprotocol/codex-acp` | `codex login`; `CODEX_PATH` | official ACP adapter |

A missing CLI fails with `Install X and log in`, not a stack trace.

## Config

Root `cordis.patch.yml` also inserts `lumine-goal-completion` (`timeoutMs: 900000`, `failClosed: true`, optional `judgePreset`). In CI the judge is a fake that never approves. Generation of the runtime judge never writes a DeepSeek key.

`cordis.patch.yml` / profile overlay on `id: lumine-acp-session`:

```yaml
- id: lumine-acp-session
  config:
    permission: yolo          # or ask (uses dsh-user-approval; still allows if no answerer)
    defaultProvider: claude   # claude | codex | cursor | grok
    worktrees:
      mode: auto              # auto | always | never (Raphael-shaped pooled trees)
    providers:
      cursor:
        command: cursor-agent
        args: [acp]
      claude:
        productCommand: claude
      codex:
        productCommand: codex
        allowApiKey: false
      grok:
        command: grok
        args: [agent, --always-approve, stdio]
```

Permission default is **yolo** (`allow_always` / `--always-approve` / bypass where the product supports it). Tool calls still land in the session log; `@lumine/dsh-chat` folds consecutive ones into one Lumine-style activity strip so the transcript does not list every `read_file`.

### Worktrees

Sessions whose picker cwd is a git repo run the official CLI in a **pooled git worktree**, same model as Raphael:

- Pool path: `~/atlassian/.lumine/worktrees/<repo>-<sha6(remote)>/<n>/<repo>` on an Atlassian box (`~/atlassian` exists), otherwise `~/.lumine/worktrees/…`. Separate from Raphael's `.raphael/worktrees` so the two apps cannot steal each other's trees.
- A nil base starts from the **refreshed default branch** (`origin/HEAD`, then `origin/master` / `origin/main` / `master` / `main`). Never the picker HEAD — a feature checkout routinely carries unmerged commits.
- Reclaim is conservative: a tree is reused only when the checkout is clean and the committed work is on the mainline or the exact tip is already on a remote. Dirty / unlanded trees are left alone.
- Idle trees stay until the pool grows past **10**; claimable extras are removed on release.
- Checkout uses `checkout.workers=4`, never `0` (one worker per core lags the machine).
- Resume re-attaches the stored `worktreePath` on `request/context` without resetting in-progress files.
- Already-pooled cwd (Lumine or Raphael) is used as-is so trees are not nested.
- Acquire is fail-open: a git error logs a warning and the session uses the picker path.

`mode: never` disables pooling. `always` fails the session if cwd is not a git repo.

## Layout

```
lumine-dsh/                      # root bundle (dsh.bundle)
  cordis.patch.yml
  packages/acp-session/          # @lumine/dsh-acp-session (dsh.bundle)
    src/                         # factory, ACP client, event map, command resolution
    presets/                     # four picker rows, no DSH tools
  packages/goal-completion/      # @lumine/dsh-goal-completion (dsh.bundle)
    src/                         # certifier, update_goal wrap, ACP marker fallback
  packages/routines/             # @lumine/dsh-routines (dsh.bundle + dsh.client)
    src/                         # calendar, persist, RPC, timer, spawn
    src/client/                  # left-rail Routines pane
  packages/chat/                 # @lumine/dsh-chat (dsh.bundle + dsh.client)
    src/                         # empty host apply
    src/client/                  # Lumine activity-strip tool grouping
```

## Develop

```sh
pnpm install
pnpm build
pnpm test
```

Tests use a fake ACP child. They do not require live CLIs.

## What this is not

- Not a fork of DeepSeek Harness.
- Not a DSH tool-loop that delegates to these products as one-shot subagents.
- Not an unofficial ChatGPT/Claude HTTP client.
