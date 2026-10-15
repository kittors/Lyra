<p align="center">
  <img src="assets/lyra.png" alt="Lyra" width="200">
</p>

<p align="center">
  <a href="https://github.com/kittors/Lyra/actions/workflows/ci.yml"><img src="https://github.com/kittors/Lyra/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href=".nvmrc"><img src="https://img.shields.io/badge/node-%E2%89%A524-brightgreen.svg" alt="Node ≥ 24"></a>
</p>

<p align="center">
  <strong>English</strong> · <a href="./README.zh-CN.md">中文</a>
</p>

A standalone agent with its own model settings. The desktop app is Electron, the phone app is React Native, and the phone works on the same sessions as the computer.

This is not a shell around Claude Code or Codex. The agent loop, tools, skills, and MCP are implemented here. You bring the models, plugins, and skills.

## Download

Installers live on [Releases](https://github.com/kittors/Lyra/releases/latest). Every release includes every OS and architecture. Pick the file for this machine:

| OS | Architecture | File |
| --- | --- | --- |
| macOS | Apple silicon | `Lyra-<version>-arm64.dmg` |
| macOS | Intel | `Lyra-<version>-x64.dmg` |
| Windows | x64 | `Lyra-<version>-x64.exe` |
| Windows | Arm (Snapdragon laptops, Surface Pro X) | `Lyra-<version>-arm64.exe` |
| Linux | x64 | `Lyra-<version>-x86_64.AppImage` or `Lyra-<version>-amd64.deb` |
| Linux | arm64 (Raspberry Pi, Ampere, a Linux VM on a Mac) | `Lyra-<version>-arm64.AppImage` or `Lyra-<version>-arm64.deb` |
| Android | universal | `Lyra-<version>-android.apk` |
| iOS | universal | `Lyra-<version>-ios-unsigned.ipa` (you sign it; see below) |

If you are not sure which architecture you have: on macOS look at the chip line in About This Mac, on Windows look at System type under Settings → System → About, on Linux run `uname -m` (`x86_64` is x64, `aarch64` is arm64).

AppImage or deb, not both. AppImage needs no installer: `chmod +x` and run it on any distribution. The `.deb` is for Debian and Ubuntu: `sudo apt install ./Lyra-<version>-amd64.deb`.

Four other files are usually not what you want. The two `.zip` files are for in-app updates on macOS (they replace the app in place, so you do not drag it again). `Lyra-<version>.exe` is a combined Windows installer for x64 and arm64, about 350 MB; the per-arch installers are about 175 MB each, so use those if you know the architecture. `SHA256SUMS` is the digest list. After install, the app checks for updates and only installs a file whose digest matches. If the list is missing, it refuses to install.

## First launch

The packages are not signed with a paid certificate, so each OS blocks the first open. The way through is different on each one.

### First open on macOS

The published build is ad-hoc signed. There is no Apple Developer certificate and no notarization. A double-click hits Gatekeeper: "cannot be opened because the developer cannot be verified." Two ways through:

- Open System Settings → Privacy & Security, click Open Anyway, and confirm with your password. (Right-click → Open no longer gets past Gatekeeper since macOS 15.)
- Or drop the quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/Lyra.app
```

If the dialog says the app is damaged rather than unverified, that is a 0.6.0 or earlier build. Those were unsigned. Gatekeeper treats the bundle as broken, and the only option is the Trash. Install a later version.

### Screenshots go black after a macOS update

Screenshots use the system Screen Recording permission. Ad-hoc signing produces a different signature on every build, so after an update macOS sometimes no longer treats this as the same app. The entry is still listed under System Settings → Privacy & Security → Screen Recording, but the capture is black or fails outright.

Clear this app's record so it can ask again:

```bash
tccutil reset ScreenCapture dev.lyra.app
```

Then fully quit Lyra (⌘Q; closing the window is not enough) and open it again. The next screenshot should prompt. If it does not, turn Lyra off and on under Screen Recording, or remove the row with the minus button.

`dev.lyra.app` is Lyra's bundle id. Leave it in. `tccutil reset ScreenCapture` without it clears Screen Recording for every app on the machine.

### First open on Windows

The Windows installer is also unsigned. The first run hits SmartScreen: "Windows protected your PC." Click More info, then Run anyway.

If the wizard finishes, "Run Lyra" is checked, and you get "missing shortcut / Windows is looking for Lyra.exe" (or the Start menu and desktop icons do the same), `Lyra.exe` did not stay in the install folder. The usual cause is Microsoft Defender quarantining a large unsigned binary. Check Windows Security → Virus & threat protection → Protection history, allow the entry, and run the installer again.

In-app updates take the same path. Defender also stops the file being written under `%APPDATA%\@lyra\desktop\updates`, which shows up as a failed download near the end. Add that folder as an exclusion, allow Lyra in Protection history, and retry. The bytes already down are kept.

The installed app is always named `Lyra.exe` and is a couple of hundred MB. If the install folder also has `Lyra-<version>-<arch>.exe`, about 175 MB, that is the installer itself, not the app. That happens when the destination folder is the folder the installer was downloaded into. `Uninstall Lyra.exe` is a few hundred KB and only uninstalls. Neither of those launches the app.

### Installing on a phone

The same release carries two phone files:

- `Lyra-<version>-android.apk`: install it. The first time, the phone asks whether to allow apps from unknown sources.
- `Lyra-<version>-ios-unsigned.ipa`: **unsigned**. Double-clicking it does nothing useful. Sign it with Sideloadly, AltStore, or Xcode's Devices and Simulators, then install. A free Apple ID is enough. A signed IPA that only the developer can install is worse than an IPA anyone can sign themselves.

The phone app is a shell. It talks to Lyra on your computer. Sessions, models, and keys stay on the computer. After install, turn on the service under Settings → Mobile sync on desktop and scan the pairing code.

## Add a model first

Lyra does not ship a model, so the first launch cannot send a message. Open Settings → Models, add a provider (Base URL, API format, API Key), then add at least one model, by hand or with Fetch models; the test button on each model's row checks that it answers. The API format is **Responses**, **Anthropic Messages** or **Chat Completions**, whichever the provider documents. Fetch models also removes what you uncheck, and takes a model id the endpoint does not list: type it into the search box and press Enter. Many relays leave image models out of `/v1/models`, so that is usually how one gets added.

## What it does

- **Your models.** Any number of providers, any number of models on each, over **Responses** (`/v1/responses`), **Anthropic Messages** (`/v1/messages`) or **Chat Completions** (`/v1/chat/completions`).
- **24 built-in tools**, in the groups the code uses:
  - Files and code: `read` `write` `edit` `ls` `glob` `grep` `symbol` `lsp`
  - Commands: `bash` `bash_output`
  - Session and memory: `todo_write` `task` `skill` `rule` `recall` `learn` `ask_user` `request_credential` `list_credentials` (the last two only where a credential card can be shown)
  - Network, preview, pictures and video: `web_fetch` `web_search` `preview` `image_generate` `video_generate` (the last two offered to the model only once an image or video model is configured)

  On the desktop, five `browser_*` tools drive the browser pane as well.
- **Skills.** `SKILL.md` plus YAML frontmatter. Only the name and description enter the system prompt. The body is injected when the model calls `skill`, so dozens of skills do not burn the context window.
- **MCP.** stdio, Streamable HTTP, and SSE. Tools are named `mcp__<server>__<tool>`, so they never collide with built-ins.
- **Sub-agents.** `task` hands work to an agent with its own context window and brings back the conclusion. Seven built-ins: `general` `explore` `review` `verify` `plan` `simple` `reason`. Add more in `.lyra/agents/*.md` or `~/.lyra/agents/*.md`, or from Settings → Subagents.
- **Side chat.** A temporary conversation beside the current session. It can read the main chat. It writes nothing into it. Work that needs tools is queued on the main session.
- **Window.** A toolbar runs across the top: back and forward (⌘[ and ⌘], Alt+← and Alt+→ on Windows and Linux, or the mouse's side buttons), the sidebar toggle, the open conversation's title with its … menu, and at the far end Terminal, Browser and Git buttons beside a ⋮ Panels menu that lists every panel. A rail of icons down the left goes to Conversations, Pull requests, Scheduled, Plugins, Studio, Vault and Settings; in a window narrow enough for the sidebar to become a drawer, they move into the drawer. The sidebar and the conversation share one rounded panel. On macOS the sidebar shows the window's frosted material; Settings → Appearance → Translucent sidebar turns it off.
- **Panels.** Files, File contents, Terminal, Git, Side chat, Sub-agents, Tasks, Trace and Browser, as many open as you like. Each is a pane of its own beside the conversation, and you can drag it to any side; Settings → Appearance → Panels → Tabs puts them in one pane on the right instead. The file pane is a syntax-highlighted editor. The terminal is a real pty.
- **Split view.** Up to four conversations side by side in one window, each with its own panels. A conversation is never drawn narrower than 420 px or a panel narrower than 300 px; when the window is too narrow, panels are squeezed instead of being moved out.
- **Git.** Changes as a flat list or a tree (remembered), history, branches and CI pipelines. Commit opens a dialog: leave the message empty and the current model writes one into the field first; pick the branch to commit to, or name a new one, which is only created when you commit; Commit and push does both.
- **Replies render what the model wrote.** Markdown in your messages and in replies, formulas included (KaTeX); a `mermaid` fence becomes a diagram; a code block, formula or table wider than the column scrolls sideways, with a thin scrollbar that appears under the pointer; a path to a local file becomes a chip with the file name and the full path on hover. Right-click a file — a link in a reply, a row in the edited-files card, a file's header in File changes — to open it in Lyra, in your editor or another app, show it in Finder or Explorer, or copy its full or relative path. A 12 MB message opens and scrolls without freezing the window.
- **Fork from a message.** Fork from here, on any message you sent, starts a new conversation with everything before it and puts that message — images, attachments and references included — back in the composer to edit. The original is left as it was. It works while a turn is still running.
- **Pictures.** Add an image model — `gpt-image-*`, `dall-e-3`, `imagen-*`, Gemini's `*-image`, FLUX, Seedream and others are recognised by name — and ask for a picture in any conversation. The conversation model hands the job to `image_generate`, and the picture appears in place, up to four side by side. Paste a picture, or refer to one already in the conversation (`#1` is the newest), to have it changed. Hover a picture for Edit and Download. See [Generating images](docs/guide/image-generation.md) (in Chinese).
- **Pull requests, schedules and plugins.** From the rail: review pull requests from the code hosts you connect in Settings → Code hosting; run a prompt in a project every N minutes or at a time each day; browse the plugin market and install plugins or MCP servers.
- **Built-in formatters.** ⇧⌘F (Shift+Alt+F) formats the open file, and Settings → Code formatting can do it on every save (off by default). Prettier handles the web languages; the official formatters for Python (ruff), Go (gofmt), C, C++, C# and Java (clang-format), Swift, Dart, PHP, Lua and a few more ship inside the app, so nothing needs installing. Rust, Kotlin, Ruby and some others still use the tool installed on the machine, such as rustfmt.
- **Keep the computer awake.** A switch in Settings → General: while Lyra is open, the display does not sleep and the machine does not idle to sleep, so a long task can run overnight. Closing the lid still sleeps.
- **Mobile sync.** The phone shows the same sessions, record by record: watch a turn, approve actions, keep asking. Three paths: LAN when you share a Wi-Fi, your own domain and TLS, or both ends dial out to the relay.

## Layout

```
packages/
  core/              agent kernel: providers, loop, tools, skills, MCP, session store
  desktop/           Electron app (main process + preload + React renderer)
  mobile/            Expo / React Native app
  contract/          the line between the two processes; 236 methods in one place
  relay/             a relay you run on a public host, for when the phone and the computer cannot reach each other. one file, no dependencies; Lyra does not run one for you
  agent-cli/         the agent that reviews pull requests and triages issues in this repository's CI, on the same AgentSession
  registry-shared/   plugin catalog index format, shared by desktop and the catalog service
```

`core` is platform-neutral. The desktop main process and the sync service share one `AgentSession`, so the phone and the computer do not drift. The rules on which code may import which are listed in [ARCHITECTURE.md](ARCHITECTURE.md); `pnpm arch` and `pnpm lint` enforce them.

## Run from source

```bash
pnpm install
pnpm dev
```

The phone app is a second process:

```bash
pnpm dev:mobile
```

Enable the service under Settings → Mobile sync on desktop, then enter the address and token on the phone's pairing page.

Contributing is in [CONTRIBUTING.md](CONTRIBUTING.md). An agent asked to change this repository should read [AGENTS.md](AGENTS.md).

## Where things live

| Path | Contents |
| --- | --- |
| `~/.lyra/settings.json` | providers, models, MCP, permission mode |
| `~/.lyra/credentials.json` | API keys and the Vault's passwords, SSH keys and tokens, encrypted. The key material is `~/.lyra/vault.key` |
| `~/.lyra/sessions/sessions.db` | every conversation and what it spent (SQLite) |
| `~/.lyra/skills/`, `agents/`, `commands/`, `rules/`, `plugins/` | user-level skills, sub-agents, slash commands, rules, plugins |
| `~/.lyra/memory.json` | your personal memory, managed in Settings → Personalization |
| `~/.lyra/projects/<id>/memory/` | what one project taught it: `learned.md` from the `learn` tool, `MEMORY.md` from the optional background pass |
| `~/.lyra/session-media/` | pictures pasted into or drawn in a conversation |
| `<project>/.lyra/skills/`, `agents/`, `commands/`, `rules/`, `plugins/` | the same set at project level, preferred over user-level |
| `<project>/.lyra/prompts/identity.md`, `guidelines.md` | replace the prompt's identity line and built-in guidelines for this project |
| `<project>/LYRA.md`, `AGENTS.md`, `CLAUDE.md` | project instructions: in each folder from the working directory up to the repository root, the first of these that exists; the nearer folder comes later and wins on conflicts |

Lyra also reads Claude Code's `.claude/skills` and `.claude/commands`, `.agents/`, and the rule folders of Cursor, Windsurf, Cline and Copilot.

Moving machines is a copy of `~/.lyra`, made with the app closed. Copy `credentials.json` and `vault.key` together, or the keys will not open. Do not keep `~/.lyra` in a folder that iCloud, Dropbox or OneDrive syncs while the app runs: the session database is written through a `-wal` file beside it, and a sync client that copies one without the other leaves a database that will not open.

## Extensions

How plugins, skills, MCP, and sub-agents are laid out, and how the browser, the index, hooks, and mobile sync work:

- [Extending Lyra](docs/guide/extending.md) (in Chinese): plugin directories, `SKILL.md`, MCP servers, sub-agent definitions
- [Built-in capabilities](docs/guide/capabilities.md) (in Chinese): questions and `@` references, sub-agents and delegation, the browser and its boundary, the index, hooks, the three mobile-sync paths
- [All guides](docs/guide/README.md) (in Chinese), including [Generating images](docs/guide/image-generation.md)
- [Architecture](ARCHITECTURE.md): package graph, the boundary rules, decision records

A plugin is a bundle of skills. It does not contain MCP servers. A directory that only has `.mcp.json` is an MCP server, not a plugin. The catalog lists them separately. Installing an MCP server writes its declaration into Settings → Plugins → MCP, which is the one place on the machine for every MCP server, whether you typed it or installed it.

Remote MCP servers only follow redirects to the same origin. An address that redirects to another host or port fails to connect, and the error names where it was sent; use that address instead. A token in the server's headers is never carried to another origin.

## Appearance

Every control under Settings → Appearance takes effect as soon as you change it:

- Theme: system / light / dark, with a preview. Light is a full theme, not a fallback.
- Three colors per theme (accent, background, foreground), plus presets. The rest of the scale is derived from the contrast slider, so any background still has readable text and visible borders.
- Code: light and dark syntax themes, inline code colors, code font, size, weight, line height and letter spacing. The font menu lists the faces installed on this machine, and every one falls back to YaHei or PingFang for Chinese.
- UI font, size and weight; pointer cursor.
- Conversation width: Auto (the default; follows the pane, up to 1120 px), Standard, Wide, Extra wide, Full, or a number.
- Composer height, and whether a failed turn shows one line or the whole error.
- Tool calls: Collapsed (the default) or Expanded. Panels: Split (the default) or Tabs.
- Reduce motion: system / on / off.
- Diff marks: color or `+/-` (for color-vision deficiency).
- macOS only: font smoothing, and the translucent sidebar (on by default).

## System prompt

The structure follows [pi](https://github.com/earendil-works/pi):

```
identity (one sentence; .lyra/prompts/identity.md replaces it)
Available tools:            one-line snippet per tool
Guidelines:                 base rules (.lyra/prompts/guidelines.md replaces them) plus each loaded tool's own rules
Boundaries:                 lines that must not be crossed
Environment:                platform, shell, whether this is a git repo, model
tone, <global_user_instructions>   from Settings → Personalization, when set
<user_memory>               what you asked it to remember
<project_memory>            what this project taught it
<available_skills>          name / description / directory, no body
<rules> / <rulebook>        rules that always apply, and the list of the others
<available_subagents>       name / description / tools, how eagerly to delegate, how many at once
<project_context>           AGENTS.md and the other project files, wrapped in XML
Current working directory: …
Scratch directory: …        where throwaway files go; removed with the conversation
## Addresses                session://, skill://, artifact:// and the other addresses `read` accepts
```

What matters:

- Rules hang off the tool that contributed them (`Tool.guidelines`). A session without `bash` never sees shell advice, and never keeps stale advice around.
- The prompt only carries the one-line `snippet`. The full `description` goes out as the provider's tool schema, so the same text is not paid for twice.
- Skills list name, description, and directory. The body arrives when the model calls `skill`.
- The sub-agent list is required. Without it the model does not know the values of `subagent_type`, and a request for `explore` falls back to `general` (measured).
- `<` and `&` in a skill description are escaped, so a hostile `description` cannot close an XML tag and inject instructions.
- Today's date is not in it. It travels in a short `<env>` note after the last message, so a new day does not throw away the cached prefix.

`packages/core/test/system-prompt.test.ts` covers each of those.

## Panes

Panels open beside the conversation. Terminal, Browser and Git have their own buttons at the right end of the window's toolbar (with several conversations on screen, in each one's title bar); the ⋮ Panels menu lists every panel with its shortcut. By default each panel is a pane of its own that you arrange by dragging; Settings → Appearance → Panels → Tabs puts them in one pane on the right, one tab each. On Windows and Linux, ⌘ is Ctrl and ⌥ is Alt (⌥⌘U is Ctrl+Alt+U):

| Pane | Shortcut | What it is |
| --- | --- | --- |
| Files | ⌘P | File tree. Clicking a file opens File contents |
| File contents | ⌥⌘P | Syntax-highlighted editor. The title is the file name, not "File contents" |
| Terminal | ⌃` | A real pty, not echoed commands. Paste is Ctrl+V on Windows, Ctrl+Shift+V on Linux |
| Git | ⌘⇧R | Workspace changes (flat or tree), history, branches, pipelines; commit and push from a dialog |
| Side chat | ⌥⌘S | See above |
| Sub-agents | ⌥⌘U | What each `task` worker is doing |
| Tasks | ⌘J | The current todo list |
| Trace | ⌘L | What this turn actually sent the model: tools, skills, injected context |
| Browser | ⌘T | Built-in browser. Boundary in [Built-in capabilities](docs/guide/capabilities.md) |

A tenth, **File changes**, is opened from the edited-files card rather than the menu. It shows what this turn wrote, not the working tree, and can be popped out into its own window.

- **Width is draggable.** Drag the sidebar edge or the line between two panes; arrow keys nudge (Shift for bigger steps). Double-click the sidebar edge to restore its width, or the line between two panes to split the space evenly. Widths persist.
- **Full screen.** A pane can fill its conversation's screen; Esc brings it back. Files then becomes the tree on the left and the file on the right.
- **Editor.** Syntax highlight, wrap toggle (off by default), both scrollbars. The scrollbars paint over the content and take no width.

## Context use

A ring to the left of the model name in the composer shows how much of the model's context window this chat occupies. Click it for the breakdown:

```
Context window           12.5k / 128.0k (10%)
■ Messages                8.6k    6.7%
■ Built-in tools          2.5k    2.0%
■ System prompt           1.5k    1.2%
□ Room left             115.5k   90.2%
```

A single total only says you are running out. The breakdown says what to do: start a new chat, turn off an MCP server, or delete a `CLAUDE.md` nobody is reading. The total comes from the last reply's real usage; what was said since, and the split between segments, are estimated. Before the first reply, or right after a summary, the whole figure is an estimate and says so. Past 80% the ring turns red, because the runtime starts summarizing the oldest messages around that point. At the bottom, Memory files lists each instruction file and the project memory with what it costs; click one to open it.

## Motion

Anything that changes on screen has a matching motion: 150, 220 or 340 ms, and none when the system asks for reduced motion or Settings → Appearance → Reduce motion is on.

- **Sidebar.** `margin-left` slides from 0 to the negative of the current width, with a fade. The toggle sits in the window's toolbar after back and forward and does not travel with the sidebar. The fill inside its icon is the current state; while the sidebar is hidden, a dot on it says a conversation is waiting, failed or finished. ⌘B (Ctrl+B) toggles.
- **Tool calls.** By default a turn's calls sit under one line, one row per call. A running row has a light sweeping across its words and a seconds count; a finished one goes quiet; a failed or stopped one keeps its mark; `+N −M` pops in with a short overshoot. Settings → Appearance → Tool calls → Expanded brings back the bordered cards: a blue border, a pulsing icon, a spinner, a rail along the bottom, and a tick when done.
- **Waiting on the model.** A small orb whose pattern follows what the agent is doing — thinking, reading, writing, editing, running a command, searching, testing, fetching, planning — beside a short phrase that changes every few seconds, the elapsed time, the token count and an estimated tokens per second. It sits under your latest message.
- **Approvals and questions.** The card sits directly above the composer and takes its own height, so the conversation scrolls above it instead of hiding behind it.
- **Message actions.** Time and copy, and on your own messages undo, edit and resend, and Fork from here, appear only while the pointer is on that message, without changing the line height.
- **Buttons.** Hover and press change the background; tab strips shrink slightly when pressed. The suggestions under the welcome page's composer unfold one after another, and their outline darkens on hover.

## Permissions

Three modes, switched from the lower-left of the composer:

- **Ask for approval**: ask on every write, command, and network call
- **Auto approve**: read-only commands (`git status`, `ls`, `grep`…) go through; the rest still ask
- **Full access**: everything goes through

"Always allow" entries are stored in `settings.json` under `alwaysAllow`.

## Session storage

Sessions live in one SQLite database. Each session is an append-only list of records, and every record has a monotonically increasing `seq`:

```json
{"seq":3,"ts":1786230000000,"type":"message","message":{"role":"user",...}}
```

The phone pulls a delta with `?since=N`. Each record is numbered inside the write transaction that stores it, so concurrent tool results never share a number. A collision would drop messages on the phone with no error (`packages/core/test/store.test.ts` covers that regression). A reply is written while it streams, so a crash keeps what had arrived. Deleting a conversation does not take what it spent off the usage page. `pnpm dump:session <id>` prints a session's records one per line, in the shape above.

Versions before the database kept one JSONL file per session under `~/.lyra/sessions/<project>/`. The first launch of a version with the database imports them, numbering kept, and leaves the logs where they were as a backup; deleting a conversation deletes its old log too, and the old display caches are removed. Why it is built this way: [ADR-0032](docs/adr/0032-sessions-in-sqlite.md).

## Development

After a change, run the lot:

```bash
pnpm check     # lint + links + style + i18n + typecheck + arch + test
```

Or one piece:

```bash
pnpm lint          # oxlint, --deny-warnings: a warning is a failure
pnpm typecheck     # 6 packages (relay is plain JavaScript)
pnpm test          # unit tests, including component tests. node:test, not vitest or jest
pnpm arch          # dependency direction, a few seconds
pnpm package       # this machine's installer. the only place besides a release that runs electron-builder
```

Conventions are in [CONTRIBUTING.md](CONTRIBUTING.md). Package boundaries are in [ARCHITECTURE.md](ARCHITECTURE.md).
