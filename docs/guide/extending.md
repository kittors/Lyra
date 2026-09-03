# 扩展 Lyra

四种扩展方式，各自解决不同的事。

| | 是什么 | 放哪 |
| --- | --- | --- |
| 技能 | 一段写给模型的说明，用到时才注入 | `.lyra/skills/<名>/SKILL.md` |
| 插件 | 一组技能的打包 | 装到 `~/.lyra/plugins/` |
| MCP 服务 | 一个提供工具的外部进程 | 设置 › MCP |
| 子智能体 | 一个有独立上下文的下属 | `.lyra/agents/<名>.md` |

## 技能

一个目录，里面有 `SKILL.md`，YAML frontmatter 加 Markdown 正文。

```markdown
---
name: changelog
description: 从提交记录整理一份更新说明。要写 release notes 或者总结这一轮改了什么时用。
---

读 `git log`，按 conventional commit 的类型分组……
```

**只有 `name` 和 `description` 进系统提示，正文要等模型调用 `skill` 工具时才注入。** 所以装
几十个技能不会烧上下文——代价只是每个技能一行描述。

`description` 值得认真写：模型是靠它决定要不要用这个技能的。写「处理文件」没用，写「把一批
截图按拍摄时间重命名并归档到按月份分的目录里」才有用。

| frontmatter 字段 | 作用 |
| --- | --- |
| `name` | 小写、短横线分隔。必填，也是 slash 命令的名字 |
| `description` | 什么时候该用它。最多 1024 字 |
| `allowedTools` | 只让这个技能用列出的工具。省略就是不限制 |
| `disableModelInvocation` | 设为 true 则模型看不到它，只能由用户从命令菜单调用 |

技能目录里可以放 `scripts/`、`assets/` 等资源，正文里的相对路径按技能目录解析——注入时会告诉
模型这一点。

**优先级，具体的赢**：项目里 `.lyra/skills/` 的散装技能 → 用户级 `~/.lyra/skills/` → 插件带
的 → 代码注册的。同名时前者覆盖后者，所以在插件旁边放一个同名目录就是覆盖它的方式。

## 插件

**插件是一组技能的打包，不含 MCP 服务。**

```
my-plugin/
  .lyra-plugin/plugin.json     名字、图标、描述、分类
  skills/<名>/SKILL.md
  skills/<名>/scripts/…
```

**一个包带什么，决定它是什么。** 有技能就是插件；只有 `.mcp.json` 就是一个 MCP 服务，安装它
会把声明写进设置里的 MCP 那栏——那里是这台机器上所有 MCP 服务的唯一去处，手动配的和装来的都
在一起。

这条规则是有代价换来的。市场上曾经有九个「插件」，其中七个只有一个 `.mcp.json`、零技能：它们
是 MCP 服务，被当插件卖，装完之后在 MCP 设置页查无此人，因为那页读的是 `settings.mcpServers`。
同一个服务于是有两个入口、两套开关、互不知情。

## MCP 服务

三种传输：stdio、Streamable HTTP、SSE。工具以 `mcp__<服务>__<工具>` 注入，不会和内置工具撞名。

在设置 › MCP 里配，或者装一个只带 `.mcp.json` 的包。

## 子智能体

`task` 工具把一件事交给拥有**独立上下文窗口**的下属，只把结论带回主对话。适合「读二十个文件
找出哪里定义了 X」这种——过程很长，结论很短。

内置 `general` / `explore` / `review`。自定义放在 `.lyra/agents/<名>.md`，格式与技能一样：

```markdown
---
name: reviewer
description: 审一段 diff，只报真问题
tools: [read, grep, glob]
model: deepseek-v4-flash
---

你在审查代码。只报会导致错误行为的问题……
```

| 字段 | 作用 |
| --- | --- |
| `name` | 省略则取文件名。`subagent_type` 用的就是它 |
| `description` | 主模型据此决定派给谁 |
| `tools` | 数组则限定，省略则全部可用 |
| `model` | 指定模型，省略则用当前会话的 |

正文是这个子智能体的系统提示。

项目级 `.lyra/agents/` 优先于用户级 `~/.lyra/agents/`；同名时先读到的赢。

**清单必须进系统提示**：没有它模型不知道 `subagent_type` 有哪些取值，即使用户点名 `explore`
也会退回 `general`。这是实测出来的。
