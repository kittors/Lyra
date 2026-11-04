# ADR-0043：图片进会话时缩一次，发请求时按预算带；存的是缩过的那份

- 状态：已采纳
- 日期：2026-11-05
- 相关：core `src/images/shrink.ts`、`fit.ts`、`codec.ts`、`fit-entry.ts`、`request-budget.ts`、
  `request-images.ts`，接入点 `src/ai/index.ts`（`streamAssistant`）、`src/runtime/session.ts`、
  `src/agent/tool-run.ts`、`src/tools/read.ts`；desktop `electron/image-codec.ts`、`electron/create-session.ts`、
  `src/lib/image-shrink.ts`、`src/features/composer/attachments/read.ts`；测试 `core/test/image-*.test.ts`、
  `desktop/test/create-session.test.ts`；真窗口探针 `desktop/e2e/image-shrink-probe.ts`；
  现状说明见 [docs/architecture/prompt-images.md](../architecture/prompt-images.md)

## 背景

图片从三个输入框、粘贴、标注、手机、`read`、MCP 和浏览器截图进来，全都原样进 prompt：4K 截图几 MB 一张，
12 MP 的照片照样整张。每个请求重发整段历史，所以十三张图的对话每一轮都上传 25 MB；用户走的中转上行实测
低到 15 KB/s，一轮二十八分钟。一张 6.8 MB 的 PNG 超过 Bedrock 和旧版 API 的单图上限，HEIC 哪家都不收——
被拒的图留在历史里，之后每个请求都被拒，对话就封死了。

## 决定

**一、进来时缩一次，到长边 2000、面积 3.75 MP、尽量 512 KB 以内、最多 3.75 MiB。** 数字和来源见架构文档。
所有入口：输入框（canvas，手机上也是）、人发的每条消息和新会话的首条消息、每个工具结果。缩的规则只有一份
（`shrink.ts`），两个宿主各带一个只管像素的引擎：渲染进程的 canvas、主进程的 `nativeImage`（macOS 上解不了的
格式交给 `sips`）。

**二、core 不带编解码，宿主注入。** 像 provider 注册表一样是一个绑定（`useImageCodec`），桌面启动时绑上。
没有绑的宿主（CLI）缩不了，就在请求边界把供应商会拒的图换成一句说明，其余原样发、让供应商自己缩。

**三、请求边界按模型再收、按预算带历史。** `streamAssistant` 是所有请求的必经之路。Claude 4.7 以前的标准档
只看 1568 px，就给它这么大；历史图全尺寸最多 10 张或 4 MiB，超了从最老的开始降成缩略图、再降成一句话，一次切到
60%。这一轮人发的图和刚到的那条消息里的图不降。判定每次从头重放，降下去的图不会再升回来。

**四、存缩过的那份，不存原图。** 模型看不到比它更多的像素；每轮回填和每次加载按它的大小付钱；拖进来的文件原件
还在原处、附件上有路径；标注链路记的是存储里的名字，照样成立。

**五、不用 WebP 输出。** `nativeImage` 编不了，部分 OpenAI 兼容的第三方模型不收；JPEG q90 在 11px 小字上和 PNG
一样能读（实测对比），够用。

## 后果

- 同一组样本（10 张 4K 截图 + 3 张 12 MP 照片）：第一轮请求体 24.23 MB → 2.99 MB，之后每轮 25.67 MB → 约 2 MB，
  落盘 19.27 MB → 5.16 MB。数字来自 `image-shrink-probe.ts` 改前改后各一次。
- 粘贴的截图在查看器里最大是长边 2000 的那份；要看原图的只有拖进来的文件（路径还在）。
- Windows、Linux 的主进程解不了 HEIC、TIFF，这类图在那里发出去时是一句说明，不会让请求被拒。
- 标准档 Claude 的第一个请求要把新图从 2000 再缩到 1456，十三张约一秒；之后走缓存。

## 什么时候重新考虑

- 供应商的 Files API（Anthropic、OpenAI 都有）普及到中转也支持时：传一次、按 id 引用，历史图就不必每轮上传，
  预算可以放宽。
- 用户要在设置里自己调预算时，把 `DEFAULT_IMAGE_BUDGET` 和 `ENTRY_LIMITS` 接到设置上；规则代码不用动。
