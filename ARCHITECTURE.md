# 架构

一页地图。每一节都指向真正的东西——目录、文件、或者一条记录了当初为什么这么定的 ADR。

## 一句话

Lyra 是一个 agent 运行时加两个前端。`packages/core` 平台无关，桌面端（Electron）和手机
（在 WebView 里跑桌面端的界面）驱动同一个 `AgentSession`。

## 包

| 包 | 是什么 | 依赖谁 |
| --- | --- | --- |
| `core` | agent 内核：provider 适配、agent loop、工具、skill、MCP、会话存储 | 只依赖 `registry-shared` |
| `desktop` | Electron 应用。`electron/` 主进程，`src/` 渲染进程，`shared/` 两边共有 | `core` |
| `mobile` | Expo 外壳：配对、扫码、承载桌面端界面的 WebView | 不依赖 `core`（Metro 没有 `node:`） |
| `relay` | 中转服务。单文件，零依赖，两端都连不上对方时让它们碰头 | 谁也不依赖 |
| `registry-shared` | 插件市场的契约：索引能说什么、API 答什么 | 谁也不依赖 |
| `agent-cli` | 在 CI 里审 PR、分 issue 的那个 agent，跑的是同一个 `AgentSession` | `core` |

## 两个宿主，一份界面

手机上跑的不是另一套界面，是**桌面端的那一份**——由同步服务提供，在 WebView 里加载。

```
渲染进程（一份代码）
   ├─ Electron 窗口 ──► preload ──► IPC ──► 主进程
   └─ 手机 WebView ──► bridge.ts（网络版 window.lyra）──► /api/rpc ──► sync-rpc 白名单
```

界面只认识 `window.lyra` 一个东西。桌面端用 preload 实现它，手机端用 HTTP 加一个 WebSocket
实现它，界面察觉不到差别——所以两端不会各说各的。手机能调哪些方法由
`electron/sync-rpc.ts` 的白名单决定，那份名单同时是安全边界和产品决策，一个文件从头读到尾。

见 [ADR-0001](docs/adr/0001-mobile-hosts-the-desktop-renderer.md)。

## 边界

五条，由 `.dependency-cruiser.cjs` 执行，`pnpm arch` 检查，CI 里是必过项：

1. **`core` 不 import 任何端。** 它是两个前端共用的运行时，一旦引了其中一个就不再是。
2. **渲染进程从 `core` 只能 `import type`**，白名单子入口除外。从根入口导入*值*会把整个
   index 拉进浏览器包，而它一路连到 `node:fs`——窗口一片空白。类型编译期就擦掉了，免费。
3. **渲染进程不从 `electron/` 导入值。** 类型可以（那是边界的描述），值就是把另一个进程的
   模块链进了这个包。
4. **`shared/` 谁也不依赖。** 它是两个进程共有的判断（比如「这个文件该用哪种查看器」），
   偏向任何一端就有一端用不了它。
5. **`relay` 零依赖。** 它的全部安全性就在于：转发字节，别的什么都不知道。

循环依赖目前是 warn（53 条，见 `pnpm arch` 的输出），清零后转 error。

## 要做某件事，去哪

| 想做的 | 去 |
| --- | --- |
| 加一个 IPC | `electron/ipc/<域>.ts` 注册 → `electron/ipc-types.ts` 声明 → `electron/preload.ts` 暴露；手机也要能用就加进 `electron/sync-rpc.ts` |
| 加一个内置工具 | `core/src/tools/`，经 `useToolRegistry` 那条缝 |
| 加一个右侧面板 | `src/panels/registry.ts` 注册一条记录 |
| 改设计 token | `src/styles.css` 的 `@theme` 段 |
| 加一个基础组件 | `src/components/`，配一条 `test/ui/` 的测试 |
| 判断命令危不危险 | `core/src/tools/risk*.ts` |
| 发版 | `pnpm release:rehearse` 然后 `pnpm release patch` |

## 检查

```bash
pnpm check   # lint + typecheck + test
pnpm arch    # 依赖方向
pnpm test:e2e  # 真实 Electron 窗口
```

`pnpm test` 含 2086 条：纯逻辑的在各包 `test/` 下，组件的在 `packages/desktop/test/ui/`
（happy-dom 真挂载）。e2e 在干净的 main 上有若干条稳定失败，见 [docs/architecture/testing.md](docs/architecture/testing.md)。

## 决策记录

改动与这里写的不一致时，改这里，并在 [docs/adr/](docs/adr/) 里留一条。
