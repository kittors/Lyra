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
| 打开面板 | S1 ▲ 正常 | S2 ▲ 正常 | S3 未跑 | — |
| 拖动换位 | S4 ▲ 正常 | **S5 ▲ 能拖但几乎无处可落** | — | — |
| 调整大小到底线 | S6 ▲ 正常 | S7 ▲ 正常 | — | — |
| 弹出为独立窗口 | S8 ▲ 正常 | S9 未跑 | — | — |
| 收回 | S10 够不到 | S11 未跑 | S10/S11 够不到 | — |
| 容器消失 | S12 够不到 | S13 ▲ 正常 | S14 未跑 | S15 ▲ 正常 |
| 刷新后恢复 | **S16 ▲ 坏** | **S17 ▲ 坏** | S18 未跑 | S19 未跑 |

跑法：`node --experimental-strip-types e2e/split-scenarios-probe.ts [场景前缀]`。
「够不到」= 要操作另一个窗口的 DOM，而探针只连着主窗口那一个 CDP target。

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

### C4. 把 tile 里的面板拖到另一屏，面板直接没了（S5，已复现）

**复现**：分屏两屏 → 在第一屏的标题栏点「终端」→ 拖终端的把手到第二屏中央、松手。

**实际**：终端从两屏里一起消失。再点一次第一屏的「终端」，它又开出来了——说明树里真的已经
没有它，不是画不出来。

**根因**（`pane-store.ts` 的 `endDrag`）：

```js
endDrag(cancelled) {
  const drag = get().drag;
  set({ drag: null });
  if (!drag) return;
  if (cancelled || !drag.at) set({ trees: write(get().trees, drag.scope, drag.before) });
}
```

`drag.scope` 是**按下时**那一屏，整个拖拽过程都拿它当坐标系：`dragTo` 用
`get().sizes[drag.scope]` 算落点、`preview` 往 `drag.scope` 那棵树写。拖到第二屏时落点算在
别人的地盘上，`allowedDrop` 给不出合法位置，而 `preview` 早已把面板从第一屏的树里摘掉
（它写的是 `rest`）。最后 `endDrag` 看到 `drag.at` 为空，本该拿 `drag.before` 复原——实测
没复原，面板就这么没了。

**怎么修**：两步。① 拖拽跨屏时，落点要按**指针所在**那一屏算，而不是按下时那一屏——
`dragTo` 收一个 targetScope，`sizes` 和 `preview` 都用它。② `endDrag` 的复原必须无条件覆盖
「摸过的每一屏」，而不是只有 `drag.scope` 一棵树；跨屏拖拽期间被改过的树不止一棵。

在①做好之前，②是止血：至少面板会回到原处，而不是消失。

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

**实际**（S17 已复现）：刷新前终端在 `tile:0f2ffd48`，刷新后不见了，而两屏本身都恢复了
（屏数 2→2）。所以不是分屏没恢复，是 tile 里的面板没恢复。

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

## 四、还没跑的

**探针够不到的**（要操作第二个窗口的 DOM，而 `startApp` 只连主窗口那一个 CDP target）：

- **S10/S11 收回**：收回按钮长在 panel 窗口里。
- **S12/S14 关掉 panel 窗口**：谁负责把面板放回树里。

补法：`startApp` 里加一条「按 target 标题挑 CDP 连接」的路，或者退一步——用
`bridge.windows` 上已有的 IPC 从主窗口驱动关闭，只验状态不验那个窗口的界面。

**还没写用例的**：

- **S9 tile 里的面板弹出**：`popOutPanel` 收 `dock: "pane" | "window"`，但那一屏可能在弹出
  期间被关掉，`PaneDock.tsx:69` 卸载时就 `forget(scope)` 了，home 跟着没。
- **S3 panel 窗口里能不能再开面板**（看代码是不能，PanelWindow 里没有 dock）。
- **S18/S19 panel/aux 窗口重启后恢复吗**。

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
- ~~「`endDrag` 不复原，拖一下面板就永久没了」~~——复原是好的。假象来自探针本身：面板一被
  拎起，把手元素就从 DOM 上消失，而探针还在往它身上派 pointermove/pointerup，事件冒泡不到
  window 上的监听。**拖拽类探针，按下派给把手，移动和松手派给 window。**
- ~~「tile 小到一定程度，点面板按钮什么也不会发生」~~——退路是通的，会弹成独立窗口。假象
  又是场景污染：上一轮弹出去的面板窗口还开着，这一轮 `isPopped` 为真，于是只把那个旧窗口叫到
  前面来，主窗口 DOM 一点没动。**清理要连另一个窗口一起清**（`bridge.windows.closePanel`），
  只点主窗口里的关闭按钮是不够的——面板一旦弹出去，那颗按钮就不在主窗口里了。

**方法**：这四条都是「读代码推出来的」，四条里错了四条。这份清单里凡是还没跑过的，一律当
成待验证的怀疑，不要当成事实。
