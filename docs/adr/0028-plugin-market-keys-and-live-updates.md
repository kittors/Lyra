# ADR-0028：插件市场一格一动作，MCP 的钥匙进保险箱，装过的东西自己跟上新版

- 状态：已采纳
- 日期：2026-09-26
- 相关：`packages/core/src/mcp/placeholders.ts`、`mcp/client.ts`（`resolveServer`、首次启动时限）、`plugins/loader.ts`（`sanitizeManifest`、`scanBundle`、`env` 说明）、`plugins/registry.ts`（技能集整包安装、`remember`、`collectionDirs`）、`plugins/fetch-bundle.ts`（对齐注册表的提交）、`plugins/install-record.ts`（子目录条目的更新判断）、`config/settings.ts`（MCP 钥匙进保险箱）、`skills/loader.ts`（`expandSkillPaths`）；desktop `electron/plugin-updates.ts`、`electron/plugin-index.ts`、`electron/ipc/plugins.ts`、`src/features/plugins/*`、`src/features/settings/{ExtensionsSettings,PluginsSettings,McpSettings,SkillsSettings}.tsx`；`packages/registry-shared/src/entry.ts`（`needs`、`keywords`）

## 背景

用户原话：「插件系统有两个展示和设置区域，UI 太复杂了……插件市场目前太简单了……插件要实时更新……最起码得细致做真实测试 20+ 以上的插件」。

改之前量到的：

| 地方 | 问题 |
| --- | --- |
| 市场卡片 | 每张两行元信息（公开 · 版本 · 目录名 · 作者；每个客户端一个带框的标签；技能数；下载数）、带框的下载按钮；「公开 / 个人」两个页签和卡片上的「公开」重复；上方一排已安装图标和卡片重复；两个齿轮 |
| 两个区域的跳转 | 市场里「MCP 设置」落到「常规」（设置导航里没有 `mcp` 这一项）；规则、扩展两栏的 ⋯ 打开的是插件目录 |
| MCP 钥匙 | 包里是 `${BRAVE_API_KEY}` 这样的空位，设置页不显示 env、没有地方填；`bearer_token_env_var` 在安装那一刻读环境、把令牌明文写进 settings.json |
| 稳定性 | 一个 manifest 字段类型不对（`"skills": [...]`）让整次扫描抛出，插件页一个都不剩；能力插件 `apply` 抛错让应用起不来 |
| 技能集 | 装的时候拆开改名成 `<id>-<name>` 铺进零散技能：兄弟技能之间的相对引用全断（调研的 83 种组合里 25 种）；卸载按前缀删，会删掉人自己写的同前缀技能 |
| 更新 | 只在市场卡片上算、只在人打开那一页时算；平台每天从上游重建一次；包装都在同一个仓库里，一个改动让所有包装的提交都变——「可更新」全是假的 |
| 内容 | 10 个条目 |

## 决定

1. **市场一格一动作。** 一个网格装三种东西，页头的「全部 · 插件 · MCP · 技能」筛种类，分类做成货架（按安装量排）和一排分类筛选，搜索连关键词一起搜。卡片只说四件事（图标、名字、一句话、作者和安装量）加一个动作：安装 / 更新 / 待配置 / 已安装。开关、试用、打开目录、卸载都在详情页；「只在本机」的条目单独一排。
2. **设置 › 插件管已装的。** 头部「插件市场」是带字的无框按钮；有新版时一条横幅加「全部更新」；插件行带版本、「更新」和开关；MCP 每台一张卡片：状态（已连接 · N 个工具 / 缺少密钥 / 连接失败 / 未启用）、开关、钥匙、「启动方式与环境变量」（收着）、工具（收着）。写死的「推荐」拿掉，改成去市场的一条路。跳转统一走 `openExtensions(tab)`。
3. **MCP 的钥匙。** 声明里的 `${NAME}` 是空位（和 Claude Code 的 `.mcp.json` 一样），包的 manifest 用 `env` 说明每一个（是什么、去哪申请、是否机密、能否不填）。连接时按「服务自己记着的 → 登录 shell 的环境」取值，缺值就不启动，状态里写着缺哪几个；没填的可选值不传这个变量。人填的值落盘时进保险箱（`mcp:<服务>:<名字>`），文件里只留那个空位；启动时把旧的明文搬进去。`bearer_token_env_var` 变成 `Authorization: Bearer ${NAME}` 模板。更新包时保留人填过的值。
4. **扫描和启动不被一个坏包拖垮。** manifest 逐字段按类型收下，类型不对的当没写；扫描逐包 try；`capability.js` 加载 10 秒超时，`apply` 抛错时不带已装的能力插件重建内核。
5. **技能集整包安装。** `plugins/<id>/skills/<原名>` 加一份从条目写出的 manifest：结构原样、有开关、卸载是一个目录。账本记 `skills: []`；旧装法留下的散落目录在更新时一并清走。技能正文里的 `${CLAUDE_SKILL_DIR}`、`${CLAUDE_PLUGIN_ROOT}` 交给模型前换成真路径。
6. **装过的自己跟上新版。** 主进程每 30 分钟对一次账（索引缓存和市场页共用），自动更新默认开（`autoUpdatePlugins`，关掉就只提示）；一次只换一个、和人点「更新」同一条路。侧栏在关掉自动更新时挂待更新数。装、卸、更新都让 `revision` 加一，每个窗口据此重扫。市场页开着时每 10 分钟、回到窗口时再读一次索引。
7. **更新判断。** 克隆装下的记克隆出来的提交、不记没下载过的包哈希（并先尝试检出注册表构建的那个提交）；一个大仓库里的子目录条目，版本没变就不算更新。
8. **内容。** 35 个 MCP 服务（25 个不要钥匙）+ 25 个技能集与插件（473 个技能）+ 原有 9 个，共 70 条，由 Lyra-Plugins 的 `sources.json` 生成（同步脚本支持 `pypi-mcp`、`remote-mcp`、`env` 说明）。

## 没有做的

- **不在安装时预热 MCP 服务。** 那等于在人打开开关之前就运行了它的代码。改为：经 `npx`/`uvx` 等拉起的服务，本进程里第一次启动给 180 秒（冷下载实测最长 131 秒），之后回到 30 秒。
- **不替人打开刚装的服务，也不在填完钥匙后自动打开。** 装上不等于信任；详情页在钥匙齐了之后说一句「打开上面的开关就能用」。
- **平台侧的修复这次没有部署**（按子路径算提交、每小时刷新、清单字段类型校验、子路径包带上仓库根的 LICENSE、技能数按桌面端规则），需要部署 Worker，另行确认。

## 后果

- 核心：`mcp-keys.test.ts`（空位、缺值拦截、可选不传、保险箱、迁移、坏 manifest 隔离、内联与扁平 `.mcp.json`、令牌模板）、`install-entry.test.ts`（整包安装、旧装法清理、卸载只删自己的、git 回退记账）、`install-record.test.ts`（子目录条目）、`skill-frontmatter.test.ts`（路径变量）。
- 桌面：`test/ui/plugin-market.test.ts`（网格、搜索与分类、安装后状态、更新、钥匙落盘、`*` 下的开关、来源对话框）、`plugin-install.test.ts`（更新保留钥匙）。
- 真窗口：`e2e/market-flow-probe.ts`（本地 https 测试市场，自签 CA 走 `NODE_EXTRA_CA_CERTS`）；逐项实测：`packages/core/test/market-verify-probe.ts`（真实安装 → 读取 → 启动列工具 → 用本机配置的真实模型开会话，看模型是否真的调用）。

代价：

- `PluginManifest` 多了 `env`、`mcpServers` 可以是对象；`McpServerConfig` 多了 `needs`，HTTP 服务也有 `env`；`McpServerStatus` 多了 `missing`；`InstallRecord` 多了 `skills`；`RegistryEntry` 多了 `needs`、`keywords`；`Settings` 多了 `autoUpdatePlugins`；契约多了三个方法（`plugins.updates`、`updateAll`、`environment`）和 `plugins:changed` 推送。
