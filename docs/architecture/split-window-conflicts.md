# 分屏 × 多窗口 × 浮动面板：场景矩阵与冲突清单

浮动面板（浏览器、终端、文件、Git、侧边聊天）本来只有一层容器，拖动和调整都很稳。分屏和
「在新窗口打开」各自又引入了一层容器，三者交界的地方出问题。

这份清单把交界处**枚举完**，每条写：怎么复现、期望什么、实际什么、根因、怎么修。

结论必须来自实测。本文档里凡是标 `待测` 的都还没跑过，不要当成已知事实——梳理这份清单的
过程中已经有两条「看代码就以为是 bug」的推断被实测推翻（见文末「推翻掉的推断」）。

---

## 一、先把容器关系说清楚

```
primary 窗口
└── DockView            窗口级 dock 树（可拖、可调、可弹出）
    ├── conversation 槽 → SplitWorkspace   分屏树（1–4 个会话）
    │   ├── SplitPane 会话A → PaneDock     这一屏自己的 dock 树
    │   └── SplitPane 会话B → PaneDock
    ├── browser 叶
    └── terminal 叶

aux 窗口（在新窗口打开会话）   只有转录 + 输入框，没有侧边栏、没有 dock、没有分屏
panel 窗口（把面板弹出去）     只有一个面板，没有 dock
```

三条重要事实（已由代码确认）：

- **primary 窗口只有一个。** `createWindow()` 的三处调用都有守卫。所以窗口级 dock 的
  `localStorage` key 不含 windowId 并不冲突——只有它在写。
- **aux 和 panel 窗口里没有 dock 也没有分屏。** 「在新窗口打开」不是第二个工作区。
- **终端 pty 在主进程的 registry 里**，渲染进程只是 attach/detach，关窗口不杀 shell。
  浏览器是各窗口自己的 `<webview>`，但标签列表在主进程。

---

## 二、场景矩阵

四个维度交叉。▲ = 已在真窗口里跑过（`e2e/split-dock-probe.ts`）。

| | 窗口级 dock | 分屏 tile 的 pane dock | panel 窗口 | aux 窗口 |
|---|---|---|---|---|
| 打开面板 | S1 ▲ 正常 | S2 ▲ 正常 | S3 | — |
| 拖动换位 | S4 | S5 | — | — |
| 调整大小到底线 | S6 | S7 | — | — |
| 弹出为独立窗口 | S8 | S9 | — | — |
| 收回 | S10 | S11 | S10/S11 | — |
| 容器消失（关会话/关窗口） | S12 | S13 | S14 | S15 |
| 刷新/重启后恢复 | S16 ▲ **坏** | S17 | S18 | S19 |

---

## 三、实测确认的冲突

### C0. 分屏一开，窗口 dock 的布局就再也不恢复（S16，已复现）

**复现**：开一个会话 → 右上角点「浏览器」，面板开在窗口 dock → 右键另一个会话 →
打开方式 → 分屏 → 刷新。

**实际**：分屏两屏都恢复了，**窗口 dock 的浏览器面板没了**。而 localStorage 里那份布局
好端端存着：

```
dw:dock:9da154cc… = {"v":1,"tree":{"type":"split","dir":"row",
  "children":[{"kind":"conversation"},{"kind":"browser"}],"sizes":[0.7,0.3]}}
```

存了，没读。

**根因**（`DockView.tsx:182`）：

```js
if (screens > 1) return;                       // ← 分屏多于一屏就直接返回
useDock.getState().adopt(session, allowed.current);
```

那一行本身有正当理由，注释也写了：分屏共享一个 conversation 槽，切换焦点会话时若跟着换
dock 布局，会把用户在网格旁边开的终端关掉。问题是它把「切换焦点」和「首次装载」一起挡了——
刷新之后没有任何一次 adopt 跑过，dock 就停在默认树上。

**怎么修**：把两件事分开。焦点在分屏内部换人时不 adopt（保持今天的行为），但**这个窗口第一次
装载时必须 adopt 一次**。`adopted` 这个标志已经在 store 里了，判据现成：

```js
if (screens > 1 && useDock.getState().adopted) return;
```

分屏下用哪个会话的布局？用分屏树里的第一屏（`firstSession`），不是 `activeSessionId`——
后者会随焦点漂移，而布局该跟着这个窗口装载时的样子走。

---

### C1. 从会话内容里打开面板，永远落在窗口 dock，不管人在哪一屏

**复现**：分屏成两屏 → 在右边那屏的转录里点一个文件链接（或点「审核」、点子智能体）。

**期望**：`SplitWorkspace` 的注释写明了意图——「从 tile 打开的面板属于那个 tile 的 dock」。

**实际**：面板开在窗口级 dock，横在两屏旁边。

**根因**：所有从内容触发的入口都写死了窗口 dock，没有一个问过「我在哪一屏」：

```
composer/Composer.tsx:844        useDock.getState().open("file", …)
composer/ContextMemoryFiles.tsx  useDock.getState().open("file", …)
composer/QueuedMessages.tsx:285  useDock.getState().open("chat", …)
files/FileBrowser.tsx:57         useDock.getState().open("file", …)
files/FileTitle.tsx:131          useDock.getState().open("files", …)
task/RunDetail.tsx:20            useDock.getState().open("file", …)
sidechat/SideComposer.tsx:221    useDock.getState().open("file", …)
browser-store.ts:74              useDock.getState().open("browser")
```

**范围要缩小**：右上角工具条那排按钮（终端 ⌃`、浏览器 ⌘T、Git ⌘⇧R）走的是
`toggleScopedPanel`，它认 scope，实测正确——分屏状态下点「终端」，面板落在
`tile:9da154cc` 而不是窗口 dock。所以有问题的只是上面那八个从**内容**触发的调用点，
它们绕过了 `toggleScopedPanel`。

同一个「打开文件」，从工具条点落在这一屏，从转录里点落在窗口 dock——两个结果，看不出规律。

**怎么修**：那八处改成走已经存在的 `toggleScopedPanel`（或一个同样认 scope 的
`openScopedPanel`），不再直接调 `useDock.open`。单屏时两者等价，所以不改变今天的单屏行为。

**待测**：`toggleScopedPanel` 在分屏下挑的是哪一屏——是聚焦的那一屏还是第一屏。实测那次
落在 `9da154cc`，而它既是第一屏也是当时聚焦的那一屏，分不开。要单独验。

---

### C2. 分屏 tile 的面板布局不持久化，刷新就没（S17，代码确认，待复现）

**复现**：分屏两屏 → 在左屏打开终端并调好宽度 → ⌘R 刷新。

**期望**：和窗口 dock 一样恢复。

**实际**：tile 里的面板全没了，只剩转录。（尚未单独跑过——S16 那一轮里窗口 dock 自己也没
恢复，两者混在一起，要等 C0 修好之后才分得开。）

**根因**：`usePaneDock` 是纯内存的 `Record<scope, DockNode>`，全文件没有 `localStorage`。
窗口 dock 有 `persist.ts`（`dw:dock:<session>`），pane dock 没有对应物。

**怎么修**：给 pane dock 加一份持久化，key 用 `dw:panedock:<sessionId>`。scope 本来就是
sessionId，天然是对的粒度。要连 `sizes` 一起存吗——不要：那是像素尺寸，窗口大小变了就不
该照搬，`rememberSize` 会在下一帧重新量。

---

### C3. 「回到原位」的记录只活在当前渲染进程里

**复现**：把终端从窗口 dock 弹成独立窗口 → 刷新 primary 窗口 → 在 panel 窗口上点「收回」。

**期望**：回到它离开的那个槽位。

**实际**：`homes` 这个 Map 在 `popout.ts` 的模块作用域里，刷新即清空；收回时找不到记录，
落到窗口 dock 的默认位置。

**根因**：`const homes = new Map<string, Home>()`——渲染进程内存。而 panel 窗口的存活时间
独立于 primary 的刷新。

**怎么修**：`homes` 跟着 dock 布局一起进 `localStorage`。它很小（kind → dock/scope/at），
和布局同生共死正是它该有的生命周期。

---

## 四、待测场景

下面这些有理由怀疑，但**还没实测**，不要当结论。

- **S9/S11 tile 里的面板弹出再收回**：`popOutPanel` 收了 `dock: "pane" | "window"`，
  `homes` 也记了，但 tile 可能在这期间被关掉。收回时那个 scope 已经不存在了会怎样。
- **S13 关掉分屏里的一个会话**：`PaneDock.tsx:69` 在卸载时 `forget(scope)`。如果那一屏里
  有面板被弹出去了，panel 窗口还开着，而它的 home 已经被 forget 掉。
- **S5 拖动面板跨 tile**：`usePaneDock` 的 `drag` 是单个全局字段而不是按 scope 分的，
  跨屏拖到底会发生什么。
- **S7 tile 内调整到底线**：`paneFloor` 在 tile 的像素跨度上算，2×2 分屏里每屏本来就小。
- **S12/S14 关掉 panel 窗口 vs 关掉 primary 窗口**：谁负责把面板放回树里。
- **S15 会话弹到 aux 窗口**：它在分屏里的那一屏和 pane dock 怎么处理。
- **S18/S19 panel/aux 窗口在重启后恢复吗**。

---

## 五、推翻掉的推断

四条，全是看代码时非常像 bug、实测之后站不住的。留在这里，下一个人可以省下这段路：

- ~~「窗口 dock 的 key `dw:dock:<session>` 不含 windowId，两个窗口会互相覆盖布局」~~——
  primary 窗口只有一个（`createWindow` 三处调用都有守卫），aux 和 panel 窗口里根本没有
  dock。不冲突。
- ~~「panel 窗口的 scope 只有 `"window"`，第二个窗口弹面板会抢走第一个」~~——同上，
  只有 primary 会弹。
- ~~「右上角那排按钮也写死了窗口 dock」~~——它们走 `toggleScopedPanel`，认 scope。实测分屏
  下点「终端」落在 `tile:9da154cc`。有问题的只是从内容触发的那八处。
- ~~「单屏刷新也会丢窗口 dock 的面板」~~——丢的是**另一个会话**的布局。刷新后恢复的会话是
  `c300b26e`，而浏览器存在 `9da154cc` 名下。每会话布局本来就该这样，不是 bug。这一条尤其
  值得记：它在探针里看起来和 C0 一模一样，是先做了单屏对照才分开的。

**方法**：这四条都是「读代码推出来的」，四条里错了四条。这份清单里凡是还没跑过的，一律当
成待验证的怀疑，不要当成事实。
