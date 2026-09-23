# ADR-0022：Windows 上受约束的命令在 PowerShell 里跑，Git Bash 只用在完全访问

- 状态：已采纳
- 日期：2026-09-23
- 相关：`packages/core/src/platform.ts`（`commandShell`）、`sandbox/windows/`、`sandbox/backend.ts`（`looksDenied`）、`tools/shell-guidance.ts`、`tools/risk.ts`、`tools/read-access.ts`
- 延续：[ADR-0004](0004-sandbox-fails-closed.md)（拿不到约束就拒绝）

## 背景

命令执行层按 bash 语义重做之后，Windows 上的命令一律在 Git Bash 里跑：模型只写一种语法，三个
系统通用。Windows 的沙箱是受限令牌——`WRITE_RESTRICTED` 加一个按工作区算出来的能力 SID，写入要
同时过「普通身份」和「限制 SID」两道检查，限制 SID 只在工作区上有授权。

这个令牌在真实的 Windows 运行器上第一次跑起来，是 2026-09-23 的事。之前 `EXPLICIT_ACCESS_W` 里
SID 指针写错了位置、标准句柄没设成可继承，令牌根本建不起来；ask 和 auto 两个默认模式下每条命令
都报「沙箱不可用」，而 ADR-0004 规定这时候就是拒绝执行。

令牌建起来以后，Git Bash 在它下面一行都跑不了。每个 MSYS2 程序——bash，以及 Git 用来跑钩子的
`sh`——启动时都会给自己建一条私有的信号管道，DACL 只写了用户本人、Administrators、SYSTEM，然后
以写方式打开它。写受限令牌的写入只有限制 SID 也同意才放行，而用户本人的 SID 不能放进限制 SID
——放进去等于把整个用户目录的写权限还回去。于是 bash 在第一行之前就死了：
`couldn't create signal pipe, Win32 error 5`。别的项目在同一种令牌下撞到的是同一个问题。

## 决定

**受约束的命令（`ask` = read-only、`auto` = workspace-write）在 PowerShell 里跑**：装了
PowerShell 7 用 7，否则用每台 Windows 都有的 Windows PowerShell 5.1。**完全访问（`full`）照旧
用 Git Bash**——那里没有令牌，也就没有这个问题，而 bash 是模型写得最好的语法。

随之而来的四条：

**一、按会话宣告的模式选 shell，不按单次提权后的模式。** 系统提示词告诉模型「这个会话的命令在
哪个 shell 里跑、要写什么语法」（`shell-guidance.ts`）。一次提权换的是约束，不是语法：被批准
在沙箱外重跑的那条命令，仍然是模型按 PowerShell 写的那一条。

**二、风险分级在 Windows 上两种语法都判，读取边界按实际执行它的那个 shell 判。** 风险往严里
判：同一行按 bash 读一遍、按 PowerShell 读一遍，任何一种读出风险就算有风险——
`echo "a\"; rm -rf ~; echo"` 在 bash 里是一个字符串（反斜杠转义了引号），在 PowerShell 里反斜杠
是普通字符，中间那段 `rm -rf ~` 是一条真的命令。读了哪些路径
则要按真的会解析它的那个语法算，否则 `~\.ssh` 这种写法在一种语法里指向家目录、在另一种里不是。

**三、PowerShell 一律从带 BOM 的 UTF-8 脚本文件运行（`-File`）。** 不用 `-Command`，也不用
`-EncodedCommand`：后者让 5.1 把错误序列化成 CLIXML，模型读到的是一坨 XML；命令行本身还有
32767 字符的上限，长命令直接 `ENAMETOOLONG`；脚本文件带 BOM，5.1 才按 UTF-8 读中文。

**四、只读模式也给命令一个可写的临时目录。** PowerShell 启动时要在 `%TEMP%` 里写文件探测
AppLocker，写不了就当成被锁定的机器、退到 ConstrainedLanguage——除了少数核心类型，不能调方法、
不能设属性，连它自己的 UTF-8 设置都报错，而错误信息说的是语言模式，不是沙箱。这个目录是这个
工作区自己的（按工作区路径算出来，授权 SID 也是它自己的），一个项目的命令写不到另一个项目的
临时文件；项目本身和磁盘其余部分照旧不可写。

## 没有做的

**没有给 MSYS 的信号管道授权。** 管道是 bash 自己在权限已经去掉之后建的，事先没有东西可以授权；
唯一的「授权」是把用户 SID 放进限制 SID，那就不再是沙箱了。给 MSYS 共享内存授权的那一版试过、
撤回了。

**没有让 Git Bash 在受约束模式下不受约束地跑。** 那就是 ADR-0004 禁止的「安静地退回无保护」：
上面每一层照常报告成功，实际什么都没约束住。

**没有全部换成 PowerShell。** 完全访问模式下 Git Bash 没有任何问题，而开发者的工作流（npm
脚本里的 `sh`、Git 钩子、`sed`/`awk`）大量依赖它。只在它跑不了的地方换掉它。

## 后果

**得到的**：Windows 上默认的两个权限模式里，命令第一次真的被约束——工作区内能写，外面拒绝，
只读模式什么都写不了；中文输出正确，报错是文字不是 XML，长命令能跑。这些由 CI 的 Windows 任务
在真实运行器上验证（`test/sandbox-windows.test.ts`），包括 PowerShell 7 和 5.1 两个版本。

**付出的**：受约束模式下，凡是要启动 MSYS 程序的命令——`bash script.sh`、带 `sh` 钩子的
`git commit`、Git 自带的 `usr/bin` 工具——都会被令牌拒绝。这被识别成沙箱拒绝（`looksDenied`
认得 MSYS 在令牌下的死法），和其他越界写入走同一条路：模型用 `escalate` 重试，人决定这一次
要不要放到沙箱外跑。`git` 本身是原生程序，照常能跑。

**要小心的**：管理员身份启动的 Lyra（从提升过的终端启动，或者 CI 里的 pwsh 步骤），令牌的默认
DACL 只有 Administrators（在受限令牌里是 deny-only）和 SYSTEM，受约束的进程连自己都打不开，
以 `0xC0000142` 死在 DLL 初始化里。默认 DACL 因此要加上登录 SID——普通身份和限制 SID 里唯一
共有的那一个。从 Git Bash 启动时测不出这个问题：Cygwin 会改写自己令牌的默认 DACL，子进程
继承的是改过的那份。

**什么时候重新考虑**：MSYS2/Cygwin 允许信号管道对受限令牌可写；或者有了不靠限制 SID 的写约束
（例如 AppContainer 能用在普通桌面进程上，又不打碎工具链）。到那时受约束模式也能回到 Git Bash，
模型又只需要写一种语法。
