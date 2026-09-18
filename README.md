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

A standalone agent with its own model settings. The desktop app is Electron, the phone app is React Native, and they share one session log.

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

Four other files are usually not what you want. The two `.zip` files are for in-app updates on macOS (they replace the app in place, so you do not drag it again). `Lyra-<version>.exe` is a combined Windows installer for x64 and arm64, about 230 MB; the per-arch installers are about 110 MB each, so use those if you know the architecture. `SHA256SUMS` is the digest list. After install, the app checks for updates and only installs a file whose digest matches. If the list is missing, it refuses to install.

## First launch

The packages are not signed with a paid certificate, so each OS blocks the first open. The way through is different on each one.

### First open on macOS

The published build is ad-hoc signed. There is no Apple Developer certificate and no notarization. A double-click hits Gatekeeper: "cannot be opened because the developer cannot be verified." Two ways through:

- In Finder, right-click Lyra.app → Open → Open again. Or open System Settings → Privacy & Security and click Open Anyway.
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

In-app updates take the same path. Defender also stops the file being written under `%APPDATA%\\@lyra\\desktop\\updates`, which shows up as a failed download near the end. Add that folder as an exclusion, allow Lyra in Protection history, and retry. The bytes already down are kept.

The installed app is always named `Lyra.exe` and is a couple of hundred MB. If the install folder also has `Lyra-<version>-<arch>.exe`, about 100 MB, that is the installer itself, not the app. That happens when the destination folder is the folder the installer was downloaded into. `Uninstall Lyra.exe` is a few hundred KB and only uninstalls. Neither of those launches the app.

### Installing on a phone

The same release carries two phone files:

- `Lyra-<version>-android.apk`: install it. The first time, the phone asks whether to allow apps from unknown sources.
- `Lyra-<version>-ios-unsigned.ipa`: **unsigned**. Double-clicking it does nothing useful. Sign it with Sideloadly, AltStore, or Xcode's Devices and Simulators, then install. A free Apple ID is enough. A signed IPA that only the developer can install is worse than an IPA anyone can sign themselves.

The phone app is a shell. It talks to Lyra on your computer. Sessions, models, and keys stay on the computer. After install, turn on the service under Settings → Mobile sync on desktop and scan the pairing code.

## Add a model first

Lyra does not ship a model, so the first launch cannot send a message. Open Settings → Models, add a provider (Base URL, API format, API Key), then add at least one model. The API format is **Responses** or **Anthropic Messages**. Chat Completions is not supported.

## What it does

- **Your models.** Any number of providers, any number of models on each. Only **Responses** (`/v1/responses`) and **Anthropic Messages** (`/v1/messages`).
- **20 built-in tools**, in the groups the code uses:
  - Files and code: `read` `write` `edit` `ls` `glob` `grep` `symbol` `lsp`
  - Commands: `bash` `bash_output`
  - Session and memory: `todo_write` `task` `skill` `rule` `recall` `learn` `ask_user`
  - Network and preview: `web_fetch` `web_search` `preview`
- **Skills.** `SKILL.md` plus YAML frontmatter. Only the name and description enter the system prompt. The body is injected when the model calls `skill`, so dozens of skills do not burn the context window.
- **MCP.** stdio, Streamable HTTP, and SSE. Tools are named `mcp__<server>__<tool>`, so they never collide with built-ins.
- **Sub-agents.** `task` hands work to an agent with its own context window and brings back the conclusion. Seven built-ins: `general` `explore` `review` `verify` `plan` `simple` `reason`. Add more with `.lyra/agents/*.md`.
- **Side chat.** A temporary conversation beside the current session. It can read the main chat. It writes nothing into it. Work that needs tools is queued on the main session.
- **Right-hand dock.** Nine panes, all open at once if you want: Files, File contents, Terminal, Git, Side chat, Sub-agents, Tasks, Trace, Browser. The file pane is a syntax-highlighted editor. The terminal is a real pty.
- **Replies render what the model wrote.** A `mermaid` fence becomes a diagram. A path to a local file becomes a one-line chip with the filename; the full path sits on the tooltip. A twelve-megabyte message still paints in one frame.
- **Built-in formatters.** Saving a file can run Prettier, or the language's own formatter shipped in the app (Go, Rust/Python via Ruff, C/C++, Dart, Swift, PHP, and others). You do not have to install those toolchains first.
- **Keep the computer awake while a task runs.** A switch in General settings. Closing the lid still sleeps.
- **Mobile sync.** The phone replays the same session log: watch a turn, approve actions, keep asking. Three paths: LAN when you share a Wi-Fi, your own domain and TLS, or both ends dial out to the relay.

## Layout

```
packages/
  core/              agent kernel: providers, loop, tools, skills, MCP, session store
  desktop/           Electron app (main process + preload + React renderer)
  mobile/            Expo / React Native app
  contract/          the line between the two processes; 205 methods in one place
  relay/             public relay for when the phone is not on the same LAN. one file, no dependencies
  agent-cli/         command-line entry
  registry-shared/   plugin catalog index format, shared by desktop and the catalog service
```

`core` is platform-neutral. The desktop main process and the sync service share one `AgentSession`, so the phone and the computer do not drift. Five rules govern which package may import which. `pnpm arch` enforces them. See [ARCHITECTURE.md](ARCHITECTURE.md).

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
| `~/.lyra/credentials.json` | API keys, encrypted. The key material is `~/.lyra/vault.key` |
| `~/.lyra/sessions/` | session logs (JSONL, one record per line) |
| `~/.lyra/skills/`, `plugins/`, `rules/`, `commands/` | user-level skills, plugins, rules, slash commands |
| `~/.lyra/memory.json` | what the `learn` tool wrote down |
| `<project>/.lyra/skills/`, `agents/`, `commands/`, `plugins/` | the same set at project level, preferred over user-level |
| `<project>/LYRA.md`, `AGENTS.md`, `CLAUDE.md` | project instructions, first file that exists in that order |

Moving machines is a copy of `~/.lyra`. Copy `credentials.json` and `vault.key` together, or the keys will not open.

## Extensions

How plugins, skills, MCP, and sub-agents are laid out, and how the browser, the index, hooks, and mobile sync work:

- [Extending Lyra](docs/guide/extending.md): plugin directories, `SKILL.md`, MCP servers, sub-agent definitions
- [Built-in capabilities](docs/guide/capabilities.md): the browser and its boundary, the index, hooks, the three mobile-sync paths
- [Architecture](ARCHITECTURE.md): package graph, the five boundary rules, decision records

A plugin is a bundle of skills. It does not contain MCP servers. A directory that only has `.mcp.json` is an MCP server, not a plugin. The catalog lists them separately. Installing an MCP server writes its declaration into Settings → MCP, which is the one place on the machine for every MCP server, whether you typed it or installed it.

## Appearance

Every control under Settings → Appearance actually changes the UI, by overriding CSS variables:

- Theme: system / light / dark, with a preview. Light is a full theme, not a fallback.
- Three colors are exposed (accent, background, foreground). The rest of the scale is derived from the contrast slider, so any background still has readable text and visible borders.
- UI font / code font / UI size / code size / translucent sidebar / pointer cursor / font smoothing
- Reduce motion: system / on / off
- Diff marks: color or `+/-` (for color-vision deficiency)

## System prompt

The structure follows [pi](https://github.com/earendil-works/pi):

```
identity (one sentence)
Available tools:      one-line snippet per tool
Guidelines:           base rules plus each loaded tool's own rules
Boundaries:           lines that must not be crossed
Environment:          platform, whether this is a git repo, date, model
<available_skills>    name / description / directory, no body
<available_subagents> name / description / tools
<project_context>     AGENTS.md and the other project files, wrapped in XML
Current working directory: …
```

What matters:

- Rules hang off the tool that contributed them (`Tool.guidelines`). A session without `bash` never sees shell advice, and never keeps stale advice around.
- The prompt only carries the one-line `snippet`. The full `description` goes out as the provider's tool schema, so the same text is not paid for twice.
- Skills list name, description, and directory. The body arrives when the model calls `skill`.
- The sub-agent list is required. Without it the model does not know the values of `subagent_type`, and a request for `explore` falls back to `general` (measured).
- `<` and `&` in a skill description are escaped, so a hostile `description` cannot close an XML tag and inject instructions.

`packages/core/test/system-prompt.test.ts` covers each of those.

## Panes

The right-hand dock is a tab strip. Nine panes can stay open:

| Pane | Shortcut | What it is |
| --- | --- | --- |
| Files | ⌘P | File tree. Clicking a file opens File contents |
| File contents | ⌥⌘P | Syntax-highlighted editor. The title is the file name, not "File contents" |
| Terminal | ⌃` | A real pty, not echoed commands |
| Git | ⌘⇧R | Workspace diff, one-column accordion, commit from here |
| Side chat | ⌥⌘S | See above |
| Sub-agents | ⌥⌘A | What each `task` worker is doing |
| Tasks | ⌘J | The current todo list |
| Trace | ⌘L | What this turn actually sent the model: tools, skills, injected context |
| Browser | ⌘T | Built-in browser. Boundary in [Built-in capabilities](docs/guide/capabilities.md) |

- **Width is draggable.** Sidebar and pane edges drag, double-click restores the default, arrow keys nudge. Widths persist.
- **Full screen.** A pane can fill the conversation column. Files then becomes tree on the left and file on the right. If the sidebar is collapsed, the window buttons move into the tab strip instead of floating on the pane.
- **Editor.** Syntax highlight, wrap toggle (off by default), both scrollbars. The scrollbars paint over the content and take no width.

## Context use

A ring to the left of the model name in the composer shows how much of the model's context window this chat occupies. Click it for the breakdown:

```
Context window           12.5k / 128.0k (10%)
■ Messages                8.6k    6.7%
■ Built-in tools          2.5k    2.0%
■ System prompt           1.5k    1.2%
□ Remaining             115.5k   90.2%
```

A single total only says you are running out. The breakdown says what to do: start a new chat, turn off an MCP server, or delete a `CLAUDE.md` nobody is reading. The numbers come from the last reply's real usage, not an estimate. Past 80% the ring turns red, because the runtime starts summarizing the oldest messages around that point.

## Motion

Anything that changes on screen has a matching motion, 140 to 260ms, gated by `prefers-reduced-motion`.

- **Sidebar.** `margin-left` slides from 0 to the negative of the current width, with a fade. The collapse control stays at the top-left of the window (to the right of the traffic lights) and does not travel with the sidebar. The fill inside the icon is the current state. ⌘B toggles.
- **Tool running.** The card border turns blue, the icon pulses, a stopwatch and spinner sit on the right, a progress rail travels along the bottom.
- **Tool done.** The status icon and `+N −M` counts pop in with a short overshoot.
- **Waiting on the model.** A thin arc sweeps a faint track, with elapsed time and token count beside it. Monochrome, because the reply sits next to it.
- **Approval sheet.** Slides up from the composer.
- **Message actions.** Time and copy appear only while the pointer is on that message, without changing the line height.
- **Buttons.** Hover changes color, press is `scale(0.9)`. Suggestion cards lift 2px on hover.

## Permissions

Three modes, switched from the lower-left of the composer:

- **Ask for approval**: ask on every write, command, and network call
- **Auto approve**: read-only commands (`git status`, `ls`, `grep`…) go through; the rest still ask
- **Full access**: everything goes through

"Always allow" entries are stored in `settings.json` under `alwaysAllow`.

## Session log format

Each session is an append-only JSONL file. Every record has a monotonically increasing `seq`:

```json
{"seq":3,"ts":1786230000000,"type":"message","message":{"role":"user",...}}
```

The phone pulls a delta with `?since=N`. Concurrent tool results get their `seq` from a write queue in the store, so numbers never collide. A collision would drop messages on the phone with no error (`packages/core/test/store.test.ts` covers that regression).

## Development

After a change, run the lot:

```bash
pnpm check     # lint + style + i18n + typecheck + arch + test
```

Or one piece:

```bash
pnpm lint          # oxlint, --deny-warnings: a warning is a failure
pnpm typecheck     # 7 packages
pnpm test          # unit tests, including component tests. node:test, not vitest or jest
pnpm arch          # dependency direction, a couple of seconds
pnpm package       # this machine's installer. the only place besides a release that runs electron-builder
```

Conventions are in [CONTRIBUTING.md](CONTRIBUTING.md). Package boundaries are in [ARCHITECTURE.md](ARCHITECTURE.md).
