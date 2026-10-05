# Windows 桌面适配

Lyra 共用一份渲染界面，窗口按钮继续由 Electron 的原生 Window Controls Overlay 绘制。
不按操作系统复制页面，也不通过关闭 GPU 加速来规避渲染问题。

## 窗口与标题栏

`app/window/titlebar.ts` 根据 overlay 的实际 CSS 几何计算右侧预留区；布局订阅
`geometrychange`。原生按钮区域与应用标题栏的空间只计算一次。

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
