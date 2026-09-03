# ADR-0014：动效 token 写两遍，用测试守住

- 状态：已采纳
- 日期：2026-09-03
- 相关：`packages/desktop/src/ui/motion/tokens.ts`、`styles/tokens.css`

## 背景

时长与曲线定义在 CSS 里（`--ly-t-*`、`--ly-e-*`），而少数动画是 JS 驱动的：一个 `setTimeout`
要比过渡活得久，一次 Web Animations 调用需要一个缓动字符串。它们读不到 CSS 变量。

## 决定

CSS 是真相，`ui/motion/tokens.ts` 是给 JS 用的副本，`test/ui/motion-tokens.test.ts` 读 CSS
文本比对，两边分叉就红。

## 后果

写这条测试当场就发现一处已经分叉了的：`ImageViewer` 的注释写着 `DURATION` 匹配 `--ly-t-base`，
而那是 220ms，代码里是 260。数字是对的——一张图片横穿整个窗口比任何面板走得都远，220 会显得
是被甩出去的——**错的是那句话，而且不会有任何东西说出来**。

曲线那份是真重复，换成了 token。

**代价**：两份数字。接受它，是因为另外两个选择更差——把 CSS 变量在运行时读出来要一个已挂载的
document，而这些常量在模块求值时就要用；把时长搬进 JS 再注入 CSS，等于让样式表依赖脚本。
