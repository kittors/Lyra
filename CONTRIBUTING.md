# 参与开发

## 环境

Node 24（`.nvmrc` 里写着），pnpm 11。

```bash
pnpm install     # 会顺带装上 git hooks
pnpm dev         # 桌面端
pnpm dev:mobile  # 移动端
```

`pnpm install` 会跑 `lefthook install`。之后 `git commit` 会 lint 你暂存的文件，
`git push` 会跑完整的 typecheck 和测试。要临时跳过：`LEFTHOOK=0 git commit …`——
但那意味着你打算让 CI 替你发现问题，通常不划算。

## 命令

| 命令 | 做什么 |
| --- | --- |
| `pnpm check` | lint + typecheck + test，和 CI 跑的是同一套 |
| `pnpm lint` | oxlint，`--deny-warnings`，所以警告等同于失败 |
| `pnpm lint:fix` | 能自动修的修掉 |
| `pnpm typecheck` | 三个包一起 |
| `pnpm test` | 单元测试，含组件测试 |
| `pnpm --filter @lyra/desktop test:ui` | 只跑组件测试（happy-dom，不到一秒） |
| `pnpm release:rehearse` | 触发一次 Release dry run |
| `pnpm release patch` | 发版：版本号、CHANGELOG、tag、推送 |
| `pnpm knip` | 未使用的导出、依赖、文件 |
| `pnpm build` | core + 桌面端 |
| `pnpm package` | 打出桌面端安装包 |

推之前跑 `pnpm check` 就够了；hooks 也会替你跑。

## 代码约定

**缩进用 tab**，YAML 和 JSON 用 2 空格。`.editorconfig` 里写着，编辑器会自己读。

**注释用英文，而且要解释"为什么"。** 这个仓库里的注释不复述代码在做什么——那看代码
就知道了。它们记的是当初为什么这么写：踩过什么坑、换过什么做法、为什么换回来。
一条好注释在半年后还能拦住一次重蹈覆辙。

**单文件尽量不超过 300 行。** 判据不是行数本身，而是"拆开之后是不是更好读"。
把一个东西对半切成两半、让两半互相伸手，比一个 400 行但只讲一件事的文件更糟。

**第一次在新克隆里提交前，确认 `git config user.email` 是你自己。** 仓库级配置一旦被写错，
之后每个提交都挂在错的人名下，而且改不回来——`.mailmap` 只能修显示。

**提交信息用中文，说清楚为什么。** 主题一行，然后空行，然后正文讲清楚这次改动
解决的是什么问题。改了行为就说改了什么行为。

## 测试

单元测试用 Node 自带的 `node:test`，不引测试框架：

```bash
pnpm test                                        # 全部
cd packages/core && node --test --experimental-strip-types test/session-log.test.ts
```

新加的行为要有测试盖住。规则性的东西尤其值得测——它们是"只有出错时才会被注意到"的
那类代码：分组规则、风险判定、日志去重。

组件的测试在 `packages/desktop/test/ui/`，用 happy-dom 真的挂载再断言：

```bash
pnpm --filter @lyra/desktop test:ui
```

写法上用 `createElement` 而不是 JSX（测试文件是 `.ts`），`test/helpers/mount.ts` 提供 `mount`、
`click`、`press`。断言要对着**用户能观察到的东西**——渲染出的属性、文字、可访问名——而不是内部状态。

端到端测试跑真实的 Electron 窗口：

```bash
pnpm test:e2e
```

## Pull Request

- 一个 PR 做一件事。顺手改的格式和真正的改动分开提交，评审时能分得清。
- 描述里写清楚你**实际**验证了什么，不是应该验证什么。
- UI 改动附改前/改后截图。
- CI 全绿再请人看。

仓库里有一个跑 DeepSeek V4 Flash 的 agent，PR 开起来之后它会先读一遍并留下评论。
它的意见不是结论，是第一双眼睛——不同意就在评论里说明理由。

## 项目结构

```
packages/core      Agent 运行时：循环、工具、技能、会话日志、插件内核。平台无关。
packages/desktop   Electron 应用。electron/ 是主进程，src/ 是渲染进程。
packages/mobile    React Native / Expo 应用，通过局域网同步连桌面端。
.github/           CI、模板、仓库 agent
```

core 不依赖任何一端。桌面端和移动端驱动的是同一个 `AgentSession`，所以两边的行为
不会各说各的。
