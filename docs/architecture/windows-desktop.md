# Windows 桌面适配

Lyra 共用一份渲染界面，窗口按钮继续由 Electron 的原生 Window Controls Overlay 绘制。
不按操作系统复制页面，也不通过关闭 GPU 加速来规避渲染问题。

## 窗口与标题栏

`app/window/titlebar.ts` 根据 overlay 的实际 CSS 几何计算右侧预留区；布局订阅
`geometrychange` 和 `resize`。原生按钮区域与应用标题栏的空间只计算一次。Chromium 在最大化和
还原时先发 `geometrychange`、约 150ms 后才发 `resize`，这期间 overlay 的矩形是新窗口的、
`innerWidth` 还是旧窗口的，所以 `geometrychange` 不立即读，等随后的 `resize`（没有 `resize`
跟上时在 `OVERLAY_SETTLE_MS` 后读）。立即读的结果是最大化后预留为 0、标题栏右侧按钮被原生
按钮盖住，还原后预留 472px、按钮被推到窗口中间。

只有顶部这条 header 拖动窗口。`PaneHeader` 和分屏的 `SplitChrome` 在 macOS 上是窗口的顶行，
仍是拖拽区；Windows/Linux 上它们在 header 下面、窗口中部，不再是拖拽区（`movesWindow`）——
否则右键会弹出系统菜单（还原/移动/大小……），双击会把整个窗口最大化。

模态遮罩盖不住系统画在页面外的原生按钮。`Overlay`、图片查看器和铺满窗口的视频打开时向
`ui/overlay/scrims.ts` 登记一层遮罩，`settings/window-tint.ts` 把按钮底色和符号色按遮罩混合后
重新交给 `setTitleBarOverlay`：轻遮罩（对话框 22%）跟着页面一起变暗；重遮罩（≥50%）底色变暗、
符号按深色主题画成浅灰，保证仍能看清关窗按钮。遮罩整层 `no-drag`，盖在顶部 header 上的那一截
也能点到。

窗口状态见 `electron/window-state.ts`：最大化时保存普通尺寸并另记 `maximized`，Windows/Linux
重开时恢复最大化（macOS 的缩放不是模式，不恢复）。125% 下窗口创建出来会比请求的大几个像素，
用户没有动过窗口时保存请求的尺寸，避免每次重启都长大。

主窗口（工作区和设置页）顶上是一条横贯的工具栏（ADR-0031）：Windows/Linux 上它就是原生
header，高 `NATIVE_HEADER_HEIGHT`（32px），与 Window Controls Overlay 传给系统的高度是同一个数；
macOS 上高 `MAIN_TOOLBAR_HEIGHT`（40px），红绿灯在其中居中，顶部 y=13。侧栏和各屏的卡片都在它
下面，不再为窗口的角让位。会话窗口和面板窗口仍是 `WINDOW_HEADER_HEIGHT`（44px）的标题栏，红绿灯
y=15。macOS 原生红绿灯直径为 14pt，不能按 12pt 定位，否则原生按钮会低 1pt。

`PaneHeader` 负责标题控件可用宽度：可以拖动面板时，为居于整个标题栏中心的 grip 留出
命中区；只有一个面板或窄窗口时，标题使用系统按钮和面板动作之外的剩余空间。
`TerminalTabs` 不再把这个空间折半，新增终端按钮始终位于横向滚动区域外。

Dock 按扣除侧栏后的真实空间适配。当前排列方向放不下各面板的最小尺寸，而另一方向能同时满足
宽高约束时，`fitTree` 只切换绘制方向，例如把窄窗口中的会话与终端改为上下排列。面板、分隔条和
拖拽命中共用这个结果，保存的方向与比例保持不变，扩大窗口会恢复原排列。两个方向都容纳不下时
保留按最小尺寸比例压缩的行为；这类极小空间无法同时保证所有面板的阅读宽高。

## 键盘

`ui/keyboard.ts` 按本地键盘平台呈现修饰键，而不是按远端服务器系统呈现：Windows/Linux
使用 Ctrl、Alt、Shift，Mac 保持符号表示。设置里的 Electron accelerator 保留 Control、
Command 和 Super 的区别，录制时使用物理字母键避免 Option 改写字符。

工具栏、菜单和 tooltip 共用格式化规则；编辑器的重做与格式化提示分别对应它实际使用的
CodeMirror 键位，Windows 是 Ctrl+Y 与 Shift+Alt+F。

工作区和设置的全局快捷键跳过已消费事件、重复 keydown、输入法组合态和 AltGr，避免
编辑文字时重复切换布局。面板菜单中已经公布的浏览器、任务和子 Agent 快捷键均接到对应
动作，Ctrl+` 也可在没有项目时打开主目录终端。键盘 Tab 导航有可见焦点描边。

终端里 Windows 的普通 Ctrl+V 是粘贴，和 Windows Terminal 一致（PowerShell 的 PSReadLine 本来
就会读剪贴板，cmd、Git Bash、WSL 和各种 REPL 里则只会出现 `^V`）；Linux 仍是 Ctrl+Shift+V，
Ctrl+V 留给 readline 的 quoted-insert。打包版的 Windows/Linux 菜单不带 `minimize` 角色：菜单栏
是隐藏的，这个角色只剩 Ctrl+M 加速键，打字时误按会把窗口收进任务栏。

## 字体

界面中文和标点走 `fonts.css` 的 `Lyra CJK Windows` / `Lyra Punct Windows`（雅黑）。雅黑只有常规
和粗两档，界面字重在 Windows 上降一档（`--ly-ui-weight`），于是 Markdown 的 `strong`
（medium，500）会落回常规体、和正文一样粗；Windows 上 `strong` 改用 semibold，落到雅黑粗体。

代码字体经 `lib/code/font-stack.ts` 的 `withHanFallback` 在通用族 `monospace` 之前补上中文字体
（雅黑、苹方、Noto CJK）：等宽字体没有汉字，Chromium 在 Windows 上会用新宋体回答 `monospace`
里的汉字。编辑器读 `--ly-code-font`，终端和外观页预览直接读设置值，三处都经过它。

## 路径

渲染端比较路径用 `lib/paths.ts` 的 `samePath` / `canonicalPath`：Windows 的盘符路径不区分大小写
和分隔符，`C:/a`、`c:\a` 与主进程给出的 `C:\a` 是同一个文件。打开文件时复用已开标签的写法，
`relativeTo` / `isDescendantPath` 也按这个规则判断，模型回复里正斜杠写的链接同样认得出在项目里。

## 渲染与通知开销

终端按真实行列数变化通知 PTY；逐像素 resize 仍然测量布局，但不会把同一组行列数反复
发给主进程和 Windows ConPTY。

返回对话底部和数字计数动画遵循统一的 `motionReduced()`，包括系统设置与应用内覆盖。
减少动态效果时直接呈现结果，不调度中间动画帧。转录的有界挂载、缓存与阅读位置规则
继续由 [对话渲染](conversation-rendering.md) 约束。

## 验证边界

聚焦的真实 Windows Electron 检查纳入 CI，入口与覆盖范围见 [测试](testing.md)。在其他
操作系统上模拟 overlay 协议或强制 Chromium 缩放只验证共享布局，不作为 Windows 实机
截图或原生渲染性能结论。发布验收仍需关注 Windows GPU、系统输入法、跨屏 DPI 和辅助功能。
