# ADR-0036：视频生成也是对话里的一个工具，按五种任务接口对接，拿到就落盘

- 状态：已采纳
- 日期：2026-10-13
- 相关：core `videos/`（`types.ts`、`protocol.ts`、`wire.ts`、`xai.ts`、`ark.ts`、`openai.ts`、`veo.ts`、`dashscope.ts`、`generate.ts`、`host.ts`、`mp4.ts`）、`tools/video.ts`、`tools/media-inputs.ts`、`session/payload.ts`（`persistSessionVideo`）、`images/lineage.ts`、`images/gallery.ts`；desktop `features/conversation/VideoGenerationCard.tsx`、`features/gallery/MediaStill.tsx`、`electron/preview-protocol.ts`、`electron/providers.ts`（`filmOnce`）、`electron/media-downloads.ts`；测试 `core/test/video-generate.test.ts`、`video-tool.test.ts`、`image-lineage.test.ts`；ADR-0033、ADR-0034、ADR-0035

## 背景

用户要「视频生成视频模型也得支持」「主流的一些视频模型配置，比如 seedance2.5」，画廊也要能放视频、改个名字
（定为「创作」）。视频不是一次调用：各家都是提交任务 → 轮询 → 取文件，而路径、字段、状态词没有两家一样。用户
自己的中转（CliRelay）走的是 xAI 那一套。

## 决定

1. **工具，不是对话模型**——理由同 ADR-0033。`video_generate`：提示词、首帧、尾帧、参考图、时长、比例、清晰度、
   有没有声音、反向提示词、数量。没配视频模型就不给这个工具。
2. **五种接口**，模型编辑器里可指定（`videoApi`），默认自动：
   - xAI：`POST /v1/videos/generations` → `request_id`；`GET /v1/videos/{id}` 到 `done` 取 `video.url`。
   - 火山方舟：`…/api/v3/contents/generations/tasks`，图片作为 `content` 的一部分、带 `role`；有首帧时比例
     只能 `adaptive`。Seedance 2.5 是 `doubao-seedance-2-5-260628`，4–30 秒。
   - OpenAI 视频格式：`/v1/videos` 表单 + `/content`。OpenAI 官方 2026-09-24 已关停，但 new-api 这类中转用它
     统一接可灵、万相、即梦、Vidu。
   - Google Veo：Gemini 原生 `models/{id}:predictLongRunning`，轮询 operation，文件要带 key 取。
   - 阿里百炼：`video-synthesis`（`X-DashScope-Async: enable`），万相各代字段不同（2.7 起 `resolution` +
     `ratio`，之前文生视频是像素 `size`，图生视频是 `img_url`，首尾帧是 kf2v）。
3. **自动 = 先看地址、再看名字、再试中转常见的格式**；只有「端点不存在」才换下一种，并按「地址 + 模型」记住
   走通的（同 ADR-0033 第 3 条）。别的错误不换——被接受的第二个任务就是第二份钱。
4. **各家不认的参数就近改，结果里如实说**（`adjusted`）：时长取最近的合法值、首帧决定比例、Veo 1080p 只能 8 秒、
   Veo 总有声音……模型据此告诉人。
5. **轮询的失败不是视频的失败**：任务在上游、钱已经花了。连续六次查询失败、服务商报失败、或者过了 20 分钟才
   结束等待；超时说清楚「上游可能还会生成完，没有取消」。中转忘了任务（CliRelay 在第一次报 `done` 后就删映射，
   重启也丢）——第一次 `done` 当场取地址；查不到就说「任务找不到了」。
6. **拿到就流式落盘**：`session-media/<sha1>.mp4`，不进内存 base64；从 `moov` 读宽高和时长，卡片按真实形状占位。
   签名的 CDN 链接不带 key 去取，只有内容端点和 Google 的文件 URI 带。
7. **播放按 Range 答**：`ly-media://m/*.mp4` 自己按 Range 回 206 和那一段字节（`electron/ranged-file.ts`），拖进度条
   不读整个文件。不能交给 `net.fetch(file://)`：它不管 Range 一律回 200 和整个文件，Chromium 就当这个源不能拖
   （`seekable` 是 [0, 0]），一拖就回到第一帧——文件面板里项目自己的音视频原来也是这样，一并改了。没有缩略图——`nativeImage`
   解不了视频，网格和链路里是 `<video preload="metadata">` 自己的第一帧。
8. **自己的播放器，不用系统控件**（`ui/media/VideoPlayer.tsx`）：对话卡片、创作详情、文件面板同一个。全屏按钮
   只铺满应用窗口——用 `popover="manual"` 把播放器提进顶层，元素不挪，`<video>` 不重建，视频不从头开始；铺满时整层
   `no-drag`（同图片查看器，标题栏 44px 的拖动区否则会吃掉点击），按键、Tab、焦点都留在播放器里，Esc 先于页面拿到。
   真的占满屏幕（`requestFullscreen`）放在播放器的「更多」菜单里，退出后回到进去之前的那一档。
9. **「创作」收视频**：链路把「这张图做成了视频」接上；详情页播放视频，没有改图栏（视频改不了图）。
10. **额度、内容审核、密钥**按生图的同一套分类，卡片说法一致；「停止」只停等待，卡片写明服务商那边可能已经计费。
11. **连接测试真做一段**：最短、最低清晰度、静音，按钮写明会计费——和生图「真画一张小图」一样，没有更便宜又能
    同时证明接口、密钥、模型都对的办法。

## 没做的

- 改视频、续写视频（xAI `/v1/videos/edits`、`/extensions`，Seedance 的 edit/extend）：用户这次没提，CliRelay 也没有
  对应路由。
- 可灵、MiniMax 官方直连（可灵要 AccessKey + SecretKey 签 JWT，和现在的「一个 key」配置不合）：经 new-api 等中转可用。
- 任务跨重启续等：Lyra 退出时正在等的任务，下次打开不会接着等。
- 手机上看视频（同图片，`ly-media` 在手机上没有路由）。
- CliRelay 会悄悄删掉的字段（`generate_audio`、`last_frame`、`reference_images`，以及生图的比例/清晰度/透明和多图
  `images`）——那是中转的白名单，不在这个仓库里改。

## 后果

- 视频和生图共用四层选择、输入框的按钮、@、卡片「再生成」（ADR-0035）。
- `safeMediaName` 认 `mp4/webm/mov`；下载名 `lyra-video-时间`。
