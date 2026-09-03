# 决策记录

每份记一个**当时为什么这么定**。不是文档——文档说现在是什么样，这里说为什么不是别的样，
以及什么情况下应该重新考虑。

多数内容是从源码注释里搬出来的。那些注释写得好，问题只是要打开那个文件才看得到。

| # | 决定 |
| --- | --- |
| [0001](0001-mobile-hosts-the-desktop-renderer.md) | 手机跑桌面端的界面，不自己画一套 |
| [0002](0002-relay-knows-nothing.md) | 中转服务不知道令牌，房间号是它的哈希 |
| [0003](0003-secrets-in-a-file-not-the-keychain.md) | 密钥存加密文件，不用系统钥匙串 |
| [0004](0004-sandbox-fails-closed.md) | 沙箱拿不到约束就拒绝执行，绝不退回无保护 |
| [0005](0005-tags-publish-directly.md) | 打 tag 直接发布，不留草稿 |
| [0006](0006-self-signed-is-better-than-ad-hoc.md) | macOS 用自签名证书，不用 ad-hoc |
| [0007](0007-dependencies-are-checked-not-documented.md) | 依赖方向由机器检查，新规则先报告后阻断 |
| [0008](0008-node-test-and-happy-dom.md) | 测试用 node:test，组件测试加 happy-dom |
| [0009](0009-no-build-orchestrator.md) | 不引 turbo/nx |
| [0010](0010-updates-are-verified.md) | 更新包核对摘要，验不了就不装 |
| [0011](0011-renderer-is-nine-directories.md) | 渲染进程按域分九个目录，归属按依赖判断 |
| [0012](0012-one-contract-not-three.md) | 进程边界写在一处，不是三处 |
| [0013](0013-one-button-two-heights.md) | 一个按钮组件，两种高度 |
| [0014](0014-motion-tokens-in-two-places.md) | 动效 token 写两遍，用测试守住 |
| [0015](0015-styles-are-checked-not-agreed.md) | 样式的三分法是检查，不是约定 |
| [0016](0016-look-at-it.md) | 视觉改动必须看一眼，并且逐像素对照 |
| [0017](0017-front-door-versus-code-splitting.md) | 整屏视图不进功能域的出口 |
| [0018](0018-fuses-not-yet.md) | Electron fuses 暂不启用——配了但验证不了 |
| [0019](0019-no-virtual-list-yet.md) | 长会话不上虚拟列表——量过了，不需要 |

写一份新的：复制最近一份的结构，编号往下走，加进这张表。
