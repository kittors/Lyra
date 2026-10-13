# ADR-0035：生图和视频模型按四层选，每次画的时候现读；点名和 @ 就是切换这个对话

- 状态：已采纳
- 日期：2026-10-13
- 相关：core `images/models.ts`（`mediaKind`、`resolveMediaModel`、`mediaModelLabel`、`rowsNamed`）、`images/picks.ts`（`MediaSource`、`NamedPicks`、`mentionedMedia`）、`runtime/media-turn.ts`、`runtime/turn-config.ts`、`runtime/sub-agent.ts`、`runtime/session.ts`（`setMediaModel`）、`session/types.ts`（`imageModelId`、`videoModelId`）、`trajectory/fork.ts`；contract `agent.setMediaModel`；desktop `features/models/MediaModelButton.tsx`、`MediaModelMenu.tsx`、`MediaPickMenu.tsx`、`features/composer/mention-catalog.ts`、`features/conversation/regenerate.ts`、`features/settings/SessionRows.tsx`、`ProviderModels.tsx`、`ModelEditor.tsx`；测试 `core/test/media-models.test.ts`、`media-picks.test.ts`、`session-fork.test.ts`；ADR-0025、ADR-0033

## 背景

配了好几个生图模型之后，用户原话是「新增了别的生图模型，怎么方便切换呢……我现在很迷惑」，接着是「得有可以
自由切换生图模型才是最好的，除了说，还可以 @ 就更好」。当时只有一个全局的 `Settings.imageModelId`，查下来：

- 没有「这个对话用哪个」——这个对话想用 grok、那个想用 gemini，只能来回改设置。
- 一轮开头就定死：`imageHost` 按值捕获了 providers 和默认值。它连着画几张时去设置里换，剩下几张还是旧的；
  而聊天模型是每个请求现读的（ADR-0025）。子智能体同样拿的是那一刻的全局值。
- 点名只管一张：「用 grok 画」，画完说「再暖一点」就掉回默认。
- 同名点不准：两个中转都有 `gpt-image-1`，报错让模型照「gpt-image-1 (A)」传，传回来又不认，原地打转。
- 默认被删、供应商停用、导入覆盖、项目 `.lyra/config.json` 指错，都悄悄换成第一个，哪儿也不说。
- 对话里看不出下一张会用谁；没设默认时，模型列表里也没标「自动」选中的是哪个。

## 决定

1. **四层，从具体到兜底**：这一次点名 → 这个对话（`SessionMeta.imageModelId` / `videoModelId`）→ 默认
   （`Settings.imageModelId` / `videoModelId`，项目配置可覆盖）→ 该类第一个。对话那一层不写就跟着默认走，
   和 `thinking` 在创建时快照不同：生图不往转录里留供应商句柄，没什么要钉住的，没人选过的对话应该跟着人
   一直在改的默认走。
2. **存着的选择解析不到就往下一层退，并说出来**（`stale`）。点名的不一样：名字对不上照旧报错、不回落——
   那是这一次明确要的，画成别的就是花别人的钱。存着的是以前的一句话，指的模型后来被删了，拒绝作画等于
   罚他删了模型。
3. **每次画都现读**（`MediaSource`）：对话的选择和当时的设置。一轮里中途切换，下一张就换；正在画的那张不
   打断。工具给不给仍在轮初定——一轮之内工具表不变，理由在 `delegationDecision` 上面。
4. **说和 @ 都是切换，不是「只这一张」**：点名画成功了，这个对话就改用它（`NamedPicks`）；`@名字` 在这一轮
   开头就写进对话（`media-turn.ts`），哪怕模型没把名字传给工具也照样生效。例外是对比：同一轮点了不止一个
   同类模型，就恢复到这一轮开始前的选择。子智能体里的点名只管它自己那次调用，父对话不归它改。
5. **给模型看的名字能原样传回来**（`mediaModelLabel`）：没重名就是模型 ID；重名带供应商「gpt-image-1
   (Relay A)」；供应商也同名就用本地 id。`resolveMediaModel` 认这些写法，报错列出的就是这些写法。模型多于
   一个时，工具描述里列出这些名字，省掉一轮「猜名字 → 报错 → 再猜」。
6. **输入框上一个图标，不带字**：任一类有两个以上模型才出现；悬停说生图、视频各用谁；这个对话自己选过时
   图标变强调色。菜单分生图、视频两节，每节「跟随默认（现在是 X）」、各模型、「设为默认」。没有对话时
   （空白页）选的就是默认本身，和聊天模型一样。
7. **卡片上「再生成」发一句带 @ 的话**，不在对话背后直接调：模型照原提示词和参考图重画，或把这张图做成视频；
   那句话里的 @ 同时把对话切过去。输入框里有没发出去的字时只填不发（ADR-0034 第 9 条）。
8. **设置页把「自动」标出来**：没设默认时，正在用的那一行标「默认（自动）」。

## 没做的

- 不给子智能体、定时任务单独配生图/视频模型——它们跟着所在对话走。
- 不在 @ 里认部分名字：`@grok` 既可能是智能体也可能是两个 grok 模型之一，猜就是替人做决定。

## 后果

- 换模型的入口有四个（输入框、说、@、卡片），落到同一个地方；跨窗口、手机、分叉都随会话元数据同步。
- 契约多一个 `agent.setMediaModel`（手机可调：和换聊天模型、思考档位同类，不碰凭证）。
