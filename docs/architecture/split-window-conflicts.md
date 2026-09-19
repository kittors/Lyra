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
| 打开面板 | S1 ▲ 正常 | S2 ▲ 正常 | S3 ▲ 正常（没有入口，也不该有） | — |
| 从转录内容打开 | — | A6 由单测覆盖 | — | — |
| 拖动换位 | S4 ▲ 正常 | **S5 ▲ 能拖但几乎无处可落** | — | — |
| 调整大小到底线 | S6 ▲ 正常 | S7 ▲ 正常 | — | — |
| 弹出为独立窗口 | S8 ▲ 正常 | S9 ▲ 正常 | — | — |
| 收回 | S10 ▲ 正常 | S11 ▲ 正常 | 同左 | — |
| 容器消失 | S12 ▲ 修过 | S13 ▲ 正常 | S14 ▲ 修过 | S15 ▲ 正常 |
| 刷新后恢复 | **S16 ▲ 坏** | **S17 ▲ 坏** | S18 ▲ 修过 | S19 ▲ 正常 |

跑法：`node --experimental-strip-types e2e/split-matrix-probe.ts [场景前缀]`（48+1 条），
第二个窗口那几条在 `e2e/panel-window-probe.ts`（8 条）。

**「够不到」那一列没了。** 从前 S10/S11/S12/S14 写着「要操作另一个窗口的 DOM，而探针只连着
主窗口那一个 CDP target」——那不是难，是没有路。路一直在：每个 Electron 窗口在 `/json/list`
里都是一个独立的 page target，从前只取了第一个。`app.windows()` 把每个都拿回来，认身份靠问它
`window.lyra.bootWindow`（preload 从 argv 里读的，一个窗口从生到死只有一个答案）——不靠 URL，
三种窗口 `loadFile` 的是同一个 index.html；也不靠标题，页面自己会改。

---

## 三、实测确认的冲突

### C0. 刷新之后，窗口 dock 的布局读的是一把空钥匙（已修一半）

**这一条把先前记的两条合并了**，因为逐帧追下来它们是同一个根：不是「分屏才坏」，单屏一样坏。

**根因**：`SplitWorkspace` 的 `hydrate` 只接了一个方向——树是空的而 `activeSessionId` 有值
时，把会话填进树。反过来（树里有会话、`activeSessionId` 还空着）正是刷新之后的常态，却没人
接。转录照样显示，所以很不容易发现：每一屏走 `SessionScope`，读的是树里的 id。但**窗口 dock
的布局是按 `activeSessionId` 存取的**，于是刷新后拿着 null 去读 `dw:dock:@draft`。

跨刷新的日志（往 localStorage 里记，console 活不过 reload）：

```
effect screens=1 session=null scope=null
adopt  dw:dock:@draft → null          ← 布局存在 dw:dock:9da154cc 名下，好端端的
（此后 activeSessionId 再没变过，effect 也再没跑过第二次）
```

**已修**：`hydrate` 之后把恢复出来的那一屏设成当前会话。另外 `DockView` 那句早退的判据从
`screens > 1` 改成 `screens > 1 && useDock.getState().scope`——`adopted` 不能用，它会被第一次
`adopt(null)` 置真，于是接下来那次真正带着会话的 adopt 照样被挡在门外。单屏刷新（E1）已恢复正常。

**还没修的那一半（E2）**：分屏状态下仍恢复不出来，而它不是一行代码的事——
窗口 dock 的布局按**会话**存，分屏时却有两三个会话同时在场，「当前会话」是谁就成了任意的。
浏览器在会话 A 下开的，刷新后焦点落在分屏带进来的会话 B，读 B 的钥匙拿到空布局——这在
「每会话布局」的语义里是对的。真要修得先决定：窗口 dock 的布局到底跟着窗口，还是跟着会话。
跟着窗口就该换一把 key（`dw:dock:window:<windowId>`），跟着会话就得认下「分屏时随焦点换布局」
这个后果。**这是个设计决定，不该由一次改动顺手定掉。**

---

### C0-旧. 分屏一开，窗口 dock 的布局就再也不恢复（S16，已并入 C0）

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

**已修**。实际是 **17 处**（不是八处），全部改走 `openScopedPanel`。三条分支就是那条规矩：

1. 已经在窗口 dock 上的 —— 留在那儿，只把焦点给它。搬走等于替人做了个他没提的决定。
2. 有聚焦的那一屏 —— 开进去；挤不下就弹成独立窗口（和工具条那排按钮同一条退路）。
3. 单屏 —— 就是窗口 dock，和从前一样，所以单屏行为一个字没变。

**「人在哪一屏」是注入的，不是 dock 去问分屏**（`provideScope`）。dock 反过来依赖分屏会连出
一个环；而把这段挪进分屏那一域也一样——它要用 dock 的东西，走前门就把整个 dock 域拉了进来，
绕一圈还是回到分屏。前门规则和无环规则在这种「跨域协调」的代码上是正面冲突的，注入是唯一两边
都不破的解法。没有分屏的窗口（会话窗口、面板窗口）根本不加载 `SplitWorkspace`，于是默认答案
null 正好是它们的正确答案。

顺带解开一处旧环：`sideStore.runInTerminal` 从前顺手把终端开出来，而「开在哪」在分屏之后不再
有唯一答案。现在它只记下命令，叫终端是两个调用方（文件树、代码块）各自的事——`pnpm arch` 的
已知违规也因此从 139 降到 135。

规矩由 `test/ui/scoped-open.test.ts` 六条钉着（把实现改回写死窗口 dock，其中两条立刻红）。

---

### C2. 分屏 tile 的面板布局不持久化，刷新就没（S17，代码确认，待复现）

**复现**：分屏两屏 → 在左屏打开终端并调好宽度 → ⌘R 刷新。

**期望**：和窗口 dock 一样恢复。

**实际**（S17 已复现）：刷新前终端在 `tile:0f2ffd48`，刷新后不见了，而两屏本身都恢复了
（屏数 2→2）。所以不是分屏没恢复，是 tile 里的面板没恢复。

**根因**：`usePaneDock` 是纯内存的 `Record<scope, DockNode>`，全文件没有 `localStorage`。
窗口 dock 有 `persist.ts`（`dw:dock:<session>`），pane dock 没有对应物。

**已修**：pane dock 走 `dw:panedock:<sessionId>`（scope 本来就是 sessionId，天然是对的粒度）。
`sizes` 不存——那是像素尺寸，窗口一变就不该照搬，`rememberSize` 下一帧会重新量。

顺带修掉一条**只有单写者时永远看不出来**的：`persist.ts` 的待写值从前是一个槽，后一次写把前
一次顶掉。窗口 dock 独占时每次写的都是同一把钥匙，所以无从暴露；pane dock 也开始存之后，同一
个 120ms 窗口里就有好几把钥匙争那个槽。改成按 key 排队。

还有一条同源的：写那一侧从来没有防过「没有 window」。这个文件开头就写着「存储用不了时 dock
照常工作，只是会忘事」，而读那一侧照做了（`readTree` 包了 try/catch），写那一侧没有——它一直
只被渲染进程调用。pane dock 一接上，无 DOM 的单测里 `window.setTimeout` 当场就抛。

---

### C3. 「回到原位」的记录只活在当前渲染进程里

**复现**：把终端从窗口 dock 弹成独立窗口 → 刷新 primary 窗口 → 在 panel 窗口上点「收回」。

**期望**：回到它离开的那个槽位。

**实际**：`homes` 这个 Map 在 `popout.ts` 的模块作用域里，刷新即清空；收回时找不到记录，
落到窗口 dock 的默认位置。

**根因**：`const homes = new Map<string, Home>()`——渲染进程内存。而 panel 窗口的存活时间
独立于 primary 的刷新。

**已修**：`homes` 跟着 dock 布局一起进 `localStorage`（`dw:homes`）。它很小
（kind → dock/scope/at），而面板窗口的寿命本来就独立于主窗口的刷新，所以这份记录的寿命也该
如此。坏数据当作「没有记录」——收回时落默认位置，而不是把收回这件事弄崩。

D3 现在真的验这件事：刷新之后读盘上的 `dw:homes`，而不只是看那个窗口还开着。

---

### C5. 面板窗口不是只有「收回」一条出路（S12/S14/S18，已修）

**症状**分三档，最后一档才是真正伤人的那个：

1. 人直接关掉那个面板窗口（不点收回）——面板没了，`dw:homes` 里那条记录留在盘上没人清。
2. 同上，但那是某一屏弹出去的——一样。
3. **弹出去还开着，就把整个应用关了。** 重开之后那个面板**既不在任何一棵 dock 树里**
   （弹出时已经从树上删了）**也没有窗口**（窗口列表从来不存盘）。它就这么没了，盘上只剩
   一条指着空处的记录。

**根因**：`watchPanelWindows` 只接了 `onRestorePanel` 一条事件。那条路自己会清记录——
`dockBack` 成功之后才关窗口——所以从前看起来什么都对。另外两条出路没人接。

**修法是两条规则，合起来才说得通**：

- **运行期**：面板窗口从列表里消失而不是被收回带走的，当场清掉那条记录。关掉就是关掉，
  面板不该自己跑回来，但记录也不该留着。
- **启动期**：盘上有记录、却没有对应的面板窗口——照记录把面板放回原位，然后清掉记录。

第二条之所以成立，全靠第一条：人主动关窗口时记录当场就清了，所以**到了下一次启动，还留在
盘上的就只能是「没收回就退出」的那一种**。少任何一条，另一条都会做错事——只有第二条的话，
人关掉面板窗口、再重启，那个他明明关掉了的面板会自己回来。

一屏的 dock 要等它量出自己的尺寸才收得下面板，那比第一次窗口列表晚，所以启动那条会重试六秒；
到点还放不回去就清记录——那一屏多半真的不在了，而把它的面板停到窗口 dock 上正是这个功能
一开始要避免的布局。

两条单测在 `test/ui/dock-persist.test.ts`，把实现拆掉时两条都红。

---

## 四、还没跑的

空了。

从前这一节有两组：「探针够不到的」（S10/S11/S12/S14）和「还没写用例的」（S3/S9/S18/S19）。
第一组是 `startApp` 只连主窗口那一个 target，补上 `app.windows()` 之后八条一起跑起来了；
第二组顺手就写了。结论：

- **S3**：面板窗口里没有 dock（0 个面板槽），整个窗口只有一颗按钮，没有一条路能开第二个面板。
  这是对的——「在新窗口打开」不是第二个工作区。
- **S9**：出身的那一屏被关掉之后收回，面板留在独立窗口里，没有凭空消失。这正是 `popout.ts`
  写明的取舍：家没了就留在浮动窗口里，而不是把一屏的面板停到窗口 dock 上。
- **S19**：重启之后两屏原样回来，每一屏的面板也在原位。
- **S10/S11/S12/S14/S18**：见上面 C5。

**跑出来的第一版有三条红是探针自己的毛病，不是产品的**——又一次。S10 报「面板窗口里找不到
收回按钮」，其实是等错了东西：`bootWindow` 是 preload 从 argv 里读的，窗口一出现就答得上来，
而 React 还没挂。要等那颗按钮，不等那个对象。S18/S19 报 ENOENT settings.json，是探针把自己的
地基拆了——`startApp` 默认的一次性 profile 在第一次 `stop()` 时就删了，而重启那两条要用同一份
数据再起一次。这两类假象加上先前那六条，同一个教训已经攒到第八次。

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
