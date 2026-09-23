# ADR-0004：沙箱拿不到约束就拒绝执行，绝不退回无保护

- 状态：已采纳
- 日期：2026-09-03（追记）
- 相关：`packages/core/src/sandbox/`、`docs/notes/hardening-plan.md`

## 背景

这个应用会执行模型给出的命令。沙箱是它与「模型写了 `rm -rf ~`」之间的那一层。

平台各不相同：macOS 有 `sandbox-exec`（Seatbelt），Linux 有 `bwrap`，Windows 要自己用受限令牌
做。每一个都可能不存在、可能存在但不可用。

## 决定

三条：

**探测而不是猜。** 真的跑一次 `runner + 最严的 profile -- true`。能接受最严的就能接受其余的。
结果按进程缓存——`sandbox-exec` 不会在会话中途出现。

**拿不到约束就抛 `SandboxUnavailableError`，绝不退回原始 argv。** 这是整个设计的地基。安静地
退回去会让上面每一层继续正常工作、继续报告成功，而实际什么都没约束住——那比没有沙箱更糟，
因为它看起来像有。

**Windows 上诚实地不支持，直到真的实现。** 报告没有可用后端，需要约束时明确拒绝并说明原因，
而不是假装在沙箱里跑。（受限令牌后来实现了，见 `sandbox/windows/`。）

## 后果

**得到的**：「沙箱在」是一句可以相信的话。

**接受的代价**：在没有可用后端的平台上，需要约束的命令直接不能跑。这是有意的——用户会知道，
而不是以为自己被保护着。

不做 Linux 的 Landlock：他们用的是自写的 Rust native addon，而 bwrap 已经覆盖 Linux 主路径，
为第二条路径引入原生编译链不划算。

**`workspace-write` 的真实含义是「工作区**加上系统临时目录**」**，不是「只有工作区」。写 `/tmp`
是允许的——`mkstemp` 类工具都写那里，不授权等于毁掉一半命令行工具。别把它理解成「只能碰项目
目录」。

## 2026-09-23 补：Linux 还是加了 Landlock

上面「不做 Linux 的 Landlock」那一段推翻了，前提不成立：「bwrap 已经覆盖 Linux 主路径」。
在一台原装的 Ubuntu 24.04（内核 6.8）上量过——没装 `bwrap`，而且
`apparmor_restrict_unprivileged_userns=1`，装了也拿不到它要的用户命名空间。拿不到约束就拒绝，
于是最常见的 Linux 桌面上，默认权限模式一条命令都跑不了。「绝不退回无保护」本身没错，错在
只有一条路。

Landlock 在 Ubuntu、Fedora、Debian 的内核里默认启用，无特权进程可以约束自己，约束对子进程
继承且去不掉。它回答的正是这个沙箱问的问题：哪些目录可写。当初担心的「原生编译链」也没有
出现——几个系统调用经 koffi 直接调 libc（`sandbox/linux/libc.ts`），和 Windows 受限令牌走的是
同一套 FFI。顺序是 `bwrap` 优先：只有它能断网又留着本机回环；Landlock 按端口断网，连本机 TCP
一起断，老内核断不了，探测时如实报告。

同一时期还修了 Windows：runner 在 app 里从来没启动过（Electron 按 Node 跑时把
`--lyra-sandbox-runner` 当成自己的选项，`bad option`，退出码 9，见 `sandbox/runner-entry.ts`），
受限令牌也因为结构体偏移写错一直建不起来，默认模式下同样什么都不跑。Windows 上受约束的命令为什么改在 PowerShell 里跑，
见 [ADR-0022](0022-windows-confined-commands-in-powershell.md)。
