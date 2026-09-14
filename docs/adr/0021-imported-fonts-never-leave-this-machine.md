# ADR-0021：导入的字体不离开这台机器，并排在 CJK 字体之前

- 状态：已采纳
- 日期：2026-09-09
- 相关：`packages/desktop/electron/custom-fonts.ts`、`packages/desktop/electron/font-validation.ts`、
  `packages/desktop/src/features/settings/imported-fonts.ts`、`packages/desktop/src/styles/base.css`、
  `packages/contract/src/methods.ts`

## 背景

界面字体原本只能从预置的几种里选。用户要用自己的字体——尤其中文字体，因为预置那几种的中文
是靠 `local()` 借系统字体，不同机器上长得不一样。

「让用户导入一个字体文件」这句需求里藏着四个独立的决定，每一个选错都不是小事：文件从哪来、
存在哪、怎么送进渲染进程、以及送进去之后排在字体栈的第几位。

## 决定

### 一、路径不过 IPC，只认原生选择框

`fonts.import` 不接受参数。渲染进程说不出「打开哪个文件」，它只能说「让用户挑一个」，主进程
弹 `dialog.showOpenDialog`（`properties: ["openFile"]`，不允许多选），拿到路径后自己读。

于是「渲染进程被攻破之后能读到哪些文件」这个问题的答案是：一个都读不到。契约测试
（`packages/contract/test/methods.test.ts`）把这条钉住了——它读 `ipc/fonts.ts` 的源码，检查
handler 存在、只允许单选、取消时返回 `null`。

`fonts.read` 确实收一个参数，但那是 64 位十六进制的内容哈希，正则挡在最前面，不是路径。

### 二、三个方法都不对手机开放

`fonts.list`、`fonts.import`、`fonts.read` 在契约里全是 `remote: false`。手机通过配对令牌连上
来的是一个会话，不是这台电脑的文件系统访问权；字体文件是本机文件，配对不该换来读它的能力。

代价是手机上看不到导入的字体。`settings.json` 会同步过去，所以手机拿到的 `uiFont` 里带着一个
它取不到的 family，靠字体栈后面的 `PingFang SC` 兜底。这是可接受的降级：手机少了一层自定义，
而不是坏掉。

### 三、按内容寻址，用目录 rename 提交

存储路径是 `userData/fonts/<sha256>/`，里面 `font.bin` 加 `metadata.json`。同一个文件导入两次
就是同一个 id，不会存两份；先写进临时目录、再 `rename` 成正式目录，所以中断的导入是不可见的，
而不是一个只写了一半的条目。并发导入同一份内容时 rename 会失败，失败分支去读已有条目。

读回时重新算哈希并与目录名比对：目录名就是内容的摘要，对不上就是这份数据已经不是当初存进去的
那份了，拒绝比修复更合适。

### 四、送进渲染进程的是 `data:` URL，不是文件路径

渲染进程拿到的是完整的 `data:font/...;base64,...`，没有任何本机路径。

为什么不给路径：给了路径就要开 `file://` 或者再造一个自定义协议，两条都在扩大渲染进程能碰到
的东西；而字体本来就是要整个读进内存的，省不出流式的好处。

**这条量过**。22.2 MiB 的 `Arial Unicode.ttf` 经 `data:` URL 正常加载，所以 32 MiB 的上限不是
一句空话。上限本身是这么定的：最大的中日韩字体（思源黑体一个字重约 16 MB）要能进来，同时这个
数要小到能在主进程里安全地持有两份（原始字节加 base64）。

### 五、容器校验放在存之前，但浏览器才是最后一关

`font-validation.ts` 检查签名与扩展名一致、表目录不越界不重叠、必需表齐全、WOFF2 的 brotli
流能解开且有界。它**不是**字形消毒器——`shared/custom-fonts.ts` 的注释和 `loadImportedFont`
的 `await FontFace.load()` 是同一件事的两半。

它的价值是把便宜的问题挡在便宜的地方：越界的偏移、无界的解压、名实不符的扩展名。本机 241 个
系统字体跑下来只拒了一个 `NISC18030.ttf`，它用 `bhed`/`bdat`/`bloc` 代替 `head`/`glyf`/`loca`，
是 Apple 的位图字体。

反过来，浏览器拒的比这个多：**macOS 自带的 AppleGothic 和 AppleMyungjo 都过不了 Chromium 的
消毒器**（`Invalid font data in ArrayBuffer`），因为它们带 Apple 私有的字体表。用户导入这两个
会失败，而 Chromium 对 `data:` URL 的说法是 `A network error occurred`——一个本地文件不可能有
网络错误。所以 `installFont` 把 `NetworkError` 单独译成「浏览器拒绝了这个字体文件」，否则用户
会去查网络。

### 六、导入的字体排在 `Lyra CJK` 之前

`base.css` 的 `body` 现在是：

```css
font-family: var(--ly-imported-ui-font, var(--ly-script-font, "Lyra CJK")), var(--ly-script-font, "Lyra CJK"),
  var(--ly-ui-font, var(--font-sans));
```

`Lyra CJK` 排在配置字体之前是有原因的（见 `base.css` 里那段注释和 `docs/architecture/i18n.md`）：
它带 CJK 专属的 `unicode-range`，负责中文的字号匹配和全角标点的位置。

但那是在「用户没选过」的前提下成立的。**导入是用户专门去找了一个文件回来**，一个人导入中文
字体就是想让中文用它；把 `Lyra CJK` 留在前面，等于把他挑的字体用在这一行的英文上、对他真正
在意的那一半视而不见。

所以只有导入字体能插到它前面，而且 `syncImportedUiFont` 只在浏览器**已经接受**这个 face 之后
才设 `--ly-imported-ui-font`——加载失败的字体到不了这一行，CJK 那层调整照常生效。

`Lyra CJK` 在栈里出现两次，是刻意的：没导入字体时 `var()` 的兜底解析成它自己，多一个同名条目
不产生任何代价；导入了字体时，它接住导入字体没覆盖到的 CJK 字形。

## 后果

**代码字体没有对应的变量。** 「应用为代码字体」写进 `--ly-code-font`，而 `markdown.css` 里
`Lyra CJK` 仍排在它前面，所以导入的等宽字体管拉丁字母，代码块里的中文仍由 `Lyra CJK` 绘制。
这是有意留下的不对称：代码绝大多数是拉丁字母，而 `Lyra CJK` 的字号匹配对代码块里偶尔出现的
中文反而更合适。要改的话就是加一个 `--ly-imported-code-font`，按 UI 那条的样子走。

**验证靠 `e2e/imported-font-probe.ts`。** 单元测试证明字节存住了、face 注册了，证明不了
「窗口画出来的到底是哪个字体」。probe 把每段文字画进 canvas 再哈希像素：宽度单独不够用，CJK
字形在哪个字体里都是全角，两个完全不同的字体量出来一样宽，只有画出来才分得开。

**这条 ADR 的第五节是踩出来的。** 第一次写 probe 挑了 AppleGothic 当样本字体，跑出来
`--ly-imported-ui-font` 死活不设——查到最后是浏览器拒收，而不是任何一处代码写错了。选一个
「系统自带的字体」当测试素材，看起来最安全，恰恰是这次唯一坏掉的那个假设。
