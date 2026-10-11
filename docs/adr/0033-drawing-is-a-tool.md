# ADR-0033：画图是对话里的一个工具，不是一个能选来聊天的模型

- 状态：已采纳
- 日期：2026-10-11
- 相关：`packages/core/src/images/`（`models.ts` 识别与选择、`generate.ts` 路由、`openai-images.ts`、`chat-images.ts`、`quota.ts`、`recent.ts`、`host.ts`）、`core/src/tools/image.ts`、`runtime/session-turn.ts`（工具过滤）、`runtime/turn-config.ts`（宿主能力）；desktop `src/features/conversation/ImageGenerationCard.tsx`、`ImageFrame.tsx`、`src/ui/motion/Halftone.tsx`、`src/lib/image-progress.ts`、`src/features/settings/`（`ModelEditor`、`ProviderModels`、`SessionRows`）、`electron/providers.ts`（生图模型的连接测试）；测试 `core/test/image-*.test.ts`、`desktop/test/ui/image-generation-card.test.ts`；探针 `desktop/e2e/image-generation-demo.ts`；指南 [生成图片](../guide/image-generation.md)

## 背景

要的是 ChatGPT 那种体验：对话里说「用 gpt-image-2.5 把这张图改一下」，图就画在对话里，画的时候有一块
点阵动起来。用户的中转（CliRelay）已经把 Antigravity 的 Gemini 生图模型接到了 `/v1/images`
（generations 与 JSON 形式的 edits），也能经 `/v1/chat/completions` 出图（图在 `message.images`）。

## 决定

1. **工具，不是对话模型。** 画图的请求总带着上下文——刚贴的截图、三轮前画的图、「再暖一点」——握着这些
   上下文的是正在对话的模型，由它写完整的提示词、指明用哪几张图。生图模型只看到写好的提示词和图。
   反过来，把生图模型选成对话模型，每一轮第一个请求就会被拒（中转对它的 chat 请求直接 400），
   所以生图模型从所有对话模型选择器里拿掉，只出现在「生图模型」那一处。
2. **按名字认，存的开关优先，开关只在和名字不一致时才存。** 离线目录不收只出图的模型，中转的
   `/v1/models` 也大多不列，名字是唯一的信号；名字会认错，所以模型编辑器里有开关。只在不一致时存，
   规则以后改进了，没被人改过的模型跟着受益。
3. **先 Images API，`404`/「不支持这个端点」再走 chat，按「地址 + 模型」记住走通的那条。** 同一个
   Gemini 模型在 CliRelay 上走 `/v1/images`、在 OpenRouter 上只能走 chat，没有字段说明是哪种。
   额度、密钥、内容审核这类拒绝不换路——换了也是同一个拒绝。
4. **每一族用它自己的写法。** OpenAI 只收几种像素尺寸；CliRelay 前面的 Gemini 不收 `"16:9"` 当 `size`、
   忽略 `quality`，比例和清晰度要走 `aspect_ratio`、`image_size`，否则就丢了。Gemini 一次多张时一张一请求、
   并排发：中转把 `n` 串行跑、一张失败整批失败，并排既快又让一张失败只少一张。
5. **额度用完立刻结束，重试上限固定三次。** 用户的重试策略是为对话写的（「网络回来之前别放弃」），
   而生图拿到的典型失败是号池额度用完、几个小时后才恢复——按那个策略会让卡片一直转、这一轮一直挂着。
   429 正文里认出额度用完就当终局，带上上游说的恢复时间，卡片和模型都照实说。
6. **图存 `session-media`，结果里只写名字。** 重开会话照样画得出来；对话里已有的图按 `#1`（最新）、
   `#2` 编号——模型看得见图、看不见附件的标识，「最新那张」是人和模型都会说的指法。
7. **卡片画在过程块外面，点阵按目标比例占位。** 过程块一轮结束会收成一行，图是这一轮的答案。占位与
   最终尺寸一致、点阵在图解码后才淡出，图落地时下面的内容不动。没有端点报告进度，百分比是按这类
   模型通常要多久估的，逼近 96% 为止，到 100 只在图真的到了的时候。
8. **没配生图模型就不给这个工具。** 只会回答「没有生图模型」的工具，要花一轮才让模型发现这一点。
9. **生图模型的连接测试真画一张小图。** chat 请求测不了它（中转直接拒），而 Images API 没有免费的「能不能用」。
   按钮的提示写明会计费。

## 没做的

- 流式中间稿（`partial_images`）：CliRelay 对 `stream:true` 直接 400，Gemini 那条也没有中间稿。
- 生图花费没有进花销统计：Gemini 那边按 token 有 `usage`，gpt-image 经中转没有；定价也不在目录里。
- 手机端：`ly-media://` 在手机上没有对应的路由，图出不来。
- 子智能体画的图在它自己的面板里，不在主对话里。
- 「拉取模型」看不到生图模型（中转不列），要手动加一次。
