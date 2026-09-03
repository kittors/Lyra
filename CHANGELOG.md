# 更新日志

这个文件由 `pnpm release` 生成，条目来自提交信息。写得含糊的提交在这里也含糊，所以值得在提交时就写清楚。

只收录 0.8.0 及之后的版本：更早的提交信息还没有统一格式，勉强解析出来的条目比留白更容易误导。
那些版本的说明在 [GitHub Releases](https://github.com/kittors/Lyra/releases) 里。

## [0.8.36](https://github.com/kittors/Lyra/releases/tag/v0.8.36) - 2026-09-03

### 新功能

- **desktop**: 优化输入框窄屏自适应、模型菜单数字键与恢复用量统计 ([1daca56](https://github.com/kittors/Lyra/commit/1daca563167631b9eaa8c8b76d5d336fa8f9b0a1))
- 中转真的能转数据了——两端各自拨出去，在同一个房间里碰头 ([e6d9748](https://github.com/kittors/Lyra/commit/e6d974873a6af5eedb056c3c0444a28ea26c5257))
- 安卓的返回键会关掉一层，而不是直接退出应用 ([09bc3b9](https://github.com/kittors/Lyra/commit/09bc3b9662ea5f6fd509bce916c453f4bf6ef9f1))
- 抽屉跟着手指走，输入框不再被键盘压住 ([9fa96f3](https://github.com/kittors/Lyra/commit/9fa96f34acdf98694f5f180bde4d19a62f12b5f3))
- 手机上的设置只留下手机管得着的那些 ([f7702e3](https://github.com/kittors/Lyra/commit/f7702e35642197730c6d7a7851f2cd6f25fab272))
- **mobile**: 界面按手机来适配，并验证双向实时同步 ([cb37be9](https://github.com/kittors/Lyra/commit/cb37be9f310c453b1ad2db355c311aa073169ed0))
- **mobile**: 界面由桌面端托管，手机在 WebView 里装它 ([bc2a13b](https://github.com/kittors/Lyra/commit/bc2a13b70f1e482b3a4924c448e01c28bff00bb2))
- **mobile**: 手机跑桌面端自己的界面，而不是另做一套 ([4826bf2](https://github.com/kittors/Lyra/commit/4826bf27ef68ae93b0324017aace695235af87f7))
- **relay**: 中转服务，让两端都连不上对方时还能配对 ([fa1030f](https://github.com/kittors/Lyra/commit/fa1030f1cc7c468bdd2e45e602d331107b2f0612))
- **mobile**: 扫码配对，并让手机能走 https ([96ad208](https://github.com/kittors/Lyra/commit/96ad208fd5547c53d4bc058f9fdca0e6a9c947f4))
- **sync**: 配对改成扫一下，顺带修好「启用」会报端口占用 ([debbc13](https://github.com/kittors/Lyra/commit/debbc13d318770dcae4852a66a8e93f04fb46679))
- 支持会话重命名持久化与桌面/移动端实时双向同步 (#14) ([01e3fb9](https://github.com/kittors/Lyra/commit/01e3fb90f89b06b5f728fb6d2dad7bc71c77ec9b))
- 思考深度按会话隔离，并补上用量统计、滚动跟随与会话范围 ([9f09eb7](https://github.com/kittors/Lyra/commit/9f09eb79d29006ce9d89e16aeb67395d3508ba2a))
- Git 面板能看清远端并一键同步，打包不再装错架构的 native 模块 ([9bf0d6c](https://github.com/kittors/Lyra/commit/9bf0d6ca16ff7c9d0ae3ea66bfb5f5138fe23b79))

### 修复

- **desktop**: use fileURLToPath for rebuild-pty script resolution on windows ([b165a48](https://github.com/kittors/Lyra/commit/b165a48df29fc4cbddfc828dbd435d2cee3b1e33))
- **desktop,core**: fix index race, test cleanup locks and linux package target ([7ac26b3](https://github.com/kittors/Lyra/commit/7ac26b3e375b8196d577c0fd3618d93539c3e9cc))
- **test**: 显式指定 bare 仓库初始分支为 main 以兼容 CI 默认分支配置 ([b21ffa1](https://github.com/kittors/Lyra/commit/b21ffa1ec60b57e18eb829feaf11a6272b5e6887))
- 桌面端改了设置，手机上立刻就变；顺带堵上一个远程执行的口子 ([345ef09](https://github.com/kittors/Lyra/commit/345ef09e3c5e18e18ad501f0a0e60cd5cf6387ad))
- 只在悬停时出现的控件，在没有指针的设备上一直显示 ([f94f53c](https://github.com/kittors/Lyra/commit/f94f53c5a2e30a2a6cabb821880c46fed8e01a3a))
- **mobile**: 点输入框不再把整个界面放大 ([8ebc3df](https://github.com/kittors/Lyra/commit/8ebc3dfcc573974c00507f5ef83c14efb501d6fe))
- **mobile**: react-native 退回 0.86.2，并让 CI 真的去打一次包 ([652488d](https://github.com/kittors/Lyra/commit/652488dec9c48894cd8953e6126185191bf45e4f))
- 修复 Windows 下项目根目录识别 (#38) ([d0ca184](https://github.com/kittors/Lyra/commit/d0ca1841f0ab7ac8870fffe36e7b62423af6802b))
- 撤回 tailwindcss 的 major 拦截，oxlint 单独成组 ([899675c](https://github.com/kittors/Lyra/commit/899675c1b9dca31c3a3579e3801ca9adfced17e3))
- 手起的会话名不再被第一条消息冲掉 ([8ba6d92](https://github.com/kittors/Lyra/commit/8ba6d924cefc7eb075f3c1708512e61ac82f1469))
- 思考深度按会话隔离，无 id 的推理块不再被丢弃 ([59f4093](https://github.com/kittors/Lyra/commit/59f40930413c20e82e705c7c1c8eb17cf160ed3f))
## [0.8.35](https://github.com/kittors/Lyra/releases/tag/v0.8.35) - 2026-09-02

### 新功能

- 支持 AI 生成提交信息，并重做思考过程单行展示 ([cd81356](https://github.com/kittors/Lyra/commit/cd81356227d668661d1b40040982b965a6bcd2b5))

### 修复

- 给 e2e 加上超时与拆台，Dependabot 不再空烧 macOS ([267a758](https://github.com/kittors/Lyra/commit/267a7581b0ea031ea3b22671cc4cccffc4f3fba7))
## [0.8.34](https://github.com/kittors/Lyra/releases/tag/v0.8.34) - 2026-09-01

### 新功能

- 对话中途可换模型、推理档位按模型适配，并修复 Git 历史展开与截图标注，发布 0.8.34 ([e33e4fb](https://github.com/kittors/Lyra/commit/e33e4fb318e395d34b066df7324185a8a4472252))
## [0.8.33](https://github.com/kittors/Lyra/releases/tag/v0.8.33) - 2026-09-01

### 新功能

- 支持代码格式化配置、侧边对话持久化、代码外观增强与截图体验优化，发布 0.8.33 ([d634143](https://github.com/kittors/Lyra/commit/d63414362e8361dde2861b5186208afa4ae2cd89))
## [0.8.32](https://github.com/kittors/Lyra/releases/tag/v0.8.32) - 2026-08-31

### 修复

- **screenshot**: 修复截图工具条点不动、Dock 图标消失与进入闪烁，发布 0.8.32 ([7a0eefa](https://github.com/kittors/Lyra/commit/7a0eefac64e683179dcc0e8ed28e66ff05dfc6aa))
## [0.8.30](https://github.com/kittors/Lyra/releases/tag/v0.8.30) - 2026-08-31

### 修复

- **screenshot**: 修复截图后程序坞 Logo 消失及工具条样式对齐，发布 0.8.29 ([4cb6e13](https://github.com/kittors/Lyra/commit/4cb6e1395970114490521f11c9fde6257984844f))
## [0.8.28](https://github.com/kittors/Lyra/releases/tag/v0.8.28) - 2026-08-31

### 修复

- **worktree**: Windows 上会删掉正在使用的工作树 ([49f7db8](https://github.com/kittors/Lyra/commit/49f7db8115f94a5ed98c125c6971d926a36b81f8))
## [0.8.27](https://github.com/kittors/Lyra/releases/tag/v0.8.27) - 2026-08-31

### 修复

- **test**: 使用动态路径修复 tool-aliases 测试跨环境失败，发布 0.8.27 ([b320b52](https://github.com/kittors/Lyra/commit/b320b526e8f6267e26859afa86740eccb45ba514))
## [0.8.26](https://github.com/kittors/Lyra/releases/tag/v0.8.26) - 2026-08-31

### 修复

- **test**: 修复 tool-aliases 测试中的路径参数缺失，发布 0.8.26 ([c9ed4d9](https://github.com/kittors/Lyra/commit/c9ed4d9d5a0339fdf8fb48fa876c749b3ddc8992))
## [0.8.25](https://github.com/kittors/Lyra/releases/tag/v0.8.25) - 2026-08-31

### 新功能

- 完善上下文压缩降级与自动催促指引，发布 0.8.25 ([1caee28](https://github.com/kittors/Lyra/commit/1caee28dab640b10c25093fe15cb60f121727179))
## [0.8.24](https://github.com/kittors/Lyra/releases/tag/v0.8.24) - 2026-08-31

### 新功能

- **screenshot**: 改用 desktopCapturer，Windows 和 Linux 上也能截图了 ([b73aac3](https://github.com/kittors/Lyra/commit/b73aac3c378fe47d2ba47eed60ddc24fbfd1a392))

### 修复

- **screenshot**: 截图完成不再抢前台，标注粗细可调且默认更细 ([37768ad](https://github.com/kittors/Lyra/commit/37768adf85ea23c2351c3e295d1dfa8b30e3ef45))
- **git**: 环境里残留的 GIT_DIR 不再让整个应用认错仓库 ([1c0c1b4](https://github.com/kittors/Lyra/commit/1c0c1b45b5fbbc21b4e6725909755935caa4089d))
- **screenshot**: 选区能移动能缩放，八个标注工具全部可用 ([bc5e732](https://github.com/kittors/Lyra/commit/bc5e7325e71a330692f790292f68121b5b1fe1f6))
- **git**: 「不是 Git 仓库」不再被用来解释所有失败 ([376d113](https://github.com/kittors/Lyra/commit/376d113d6143bdd183bf3877a968fda444686c26))
- **desktop**: 截图不再闪一下，关掉之后主窗口也不会被埋在别的应用底下 ([bcf1083](https://github.com/kittors/Lyra/commit/bcf10834d8c88aba9c99334b5f54892eb2d40301))
- **forge**: 读不动的账号文件不再被空列表覆盖掉 ([b01ad08](https://github.com/kittors/Lyra/commit/b01ad08f0719fdca4f9fe46bf555eb8f59bc86e2))
## [0.8.23](https://github.com/kittors/Lyra/releases/tag/v0.8.23) - 2026-08-31

### 新功能

- **desktop**: 支持全屏即席截图与选区吸附式标注工具条 ([a77c21e](https://github.com/kittors/Lyra/commit/a77c21ef63690a18e285885e60891164771e42e0))

### 修复

- **test**: 测试运行前清掉 GIT_* 环境变量，否则 git hook 里跑测试会写进真实仓库 ([d90fd2d](https://github.com/kittors/Lyra/commit/d90fd2d56137310026ea60dd3dfda461fc657dc9))
- **release**: 信任证书改用 sudo 写系统钥匙串，否则流水线会挂死而不是失败 ([05290e8](https://github.com/kittors/Lyra/commit/05290e83ba1d47415c54c6cc8fbfbd0663ec5133))
- **release**: 正式发版缺签名证书时直接失败，不再只是警告 ([442fec5](https://github.com/kittors/Lyra/commit/442fec53b15f0b1da6a90e470b0518bb8b1d1d32))
## [0.8.22](https://github.com/kittors/Lyra/releases/tag/v0.8.22) - 2026-08-31

### 修复

- **release**: 用自签名证书签名 macOS 构建，更新后不再重置系统权限 ([892fdf1](https://github.com/kittors/Lyra/commit/892fdf101d104579b14ab45b98644b0692f98b8b))
## [0.8.21](https://github.com/kittors/Lyra/releases/tag/v0.8.21) - 2026-08-31

### 修复

- **test**: 在 Windows 环境下跳过 POSIX 文件权限测试 ([7a3d41a](https://github.com/kittors/Lyra/commit/7a3d41ae2e388340a856a809c0be8595f8a0ca0b))
- 更新后不再需要重新登录账号，API key 不再明文存放 ([7e0ec60](https://github.com/kittors/Lyra/commit/7e0ec600348a02b1fe56fa9b51bc7748a2e90d44))

### 性能

- **desktop**: 消除长会话下拖拽面板、缩放窗口与滚动的卡顿 ([db460c5](https://github.com/kittors/Lyra/commit/db460c574c058ef9c67d66ca6921cce04e8f5c26))
## [0.8.19](https://github.com/kittors/Lyra/releases/tag/v0.8.19) - 2026-08-30

### 新功能

- **git**: 完全移除 gh 依赖，改用原生 GitHub REST API 读取与触发 Actions 流水线 (v0.8.19) ([9347b1b](https://github.com/kittors/Lyra/commit/9347b1b004414d707ed9b688734ee3dc5ed8ecbd))

### 修复

- **desktop**: 增强 GitHub CLI 代理异常回退机制以正常读取 Actions 流水线 ([432e74b](https://github.com/kittors/Lyra/commit/432e74bc76e4c0842354734874fe3590868577ef))
## [0.8.18](https://github.com/kittors/Lyra/releases/tag/v0.8.18) - 2026-08-30

### 修复

- 修复侧边栏状态呼吸灯动画溢出遮挡与 TPS 吞吐量统计耗时 (v0.8.18) ([8324b10](https://github.com/kittors/Lyra/commit/8324b10669999baf3e21793a1aca7551b4086dbd))
## [0.8.17](https://github.com/kittors/Lyra/releases/tag/v0.8.17) - 2026-08-30

### Git

- 优化流水线面板运行态动画与矩阵任务对齐间距 (v0.8.17) ([a331967](https://github.com/kittors/Lyra/commit/a331967563684e1cb02a796628eb735a635873b7))
## [0.8.16](https://github.com/kittors/Lyra/releases/tag/v0.8.16) - 2026-08-30

### 修复

- 优化按钮与输入框高度规范，修复 Popover/Dropdown 定位与 SideChat 缓存持久化 (v0.8.16) ([1d3d4af](https://github.com/kittors/Lyra/commit/1d3d4afdcd04b062ba7dfa33e4ed2abf472aecdc))
## [0.8.15](https://github.com/kittors/Lyra/releases/tag/v0.8.15) - 2026-08-30

### 修复

- 修复 v0.8.14 会话界面塌陷、输入框被顶出窗口 (v0.8.15) ([e3ab23a](https://github.com/kittors/Lyra/commit/e3ab23a19a8761323134a77de5f07902b14fdce9))
## [0.8.14](https://github.com/kittors/Lyra/releases/tag/v0.8.14) - 2026-08-30

### 修复

- 优化模型拉取加载动画、修复设置返回滚动丢失与输入框滚动异常 (v0.8.14) ([aa2028c](https://github.com/kittors/Lyra/commit/aa2028c188416481dcc25d5740706e5c1729c35c))
## [0.8.13](https://github.com/kittors/Lyra/releases/tag/v0.8.13) - 2026-08-30

### 新功能

- 支持自定义系统指令与智能记忆系统，优化流水线状态与 Git 提交体验 (v0.8.13) ([733af47](https://github.com/kittors/Lyra/commit/733af47956b831ed3d4240fb88c51b5536a15149))
## [0.8.12](https://github.com/kittors/Lyra/releases/tag/v0.8.12) - 2026-08-30

### Release

- v0.8.12 ([e6e3ae1](https://github.com/kittors/Lyra/commit/e6e3ae1f5399e02651bbe29bc4c8cc8274850cf2))
## [0.8.8](https://github.com/kittors/Lyra/releases/tag/v0.8.8) - 2026-08-29

### 修复

- **desktop**: 优化侧边栏会话行操作按钮间距与右键菜单定位，打开菜单时抑制 Tooltip ([87283cb](https://github.com/kittors/Lyra/commit/87283cb81d881be35caf2a77c2cf061cba454c9b))
- **desktop**: fix sidechat map reference sharing in session hub ([37883c5](https://github.com/kittors/Lyra/commit/37883c5835412367521a677112aeaba4d29eb156))

### Release

- v0.8.8 ([6230f55](https://github.com/kittors/Lyra/commit/6230f558cf25cef7e7f932e396c7f5afddf730ae))
## [0.8.7](https://github.com/kittors/Lyra/releases/tag/v0.8.7) - 2026-08-29

### 新功能

- **release**: 发布 v0.8.7 并优化长对话滚动性能与 Git 面板体验 ([300165f](https://github.com/kittors/Lyra/commit/300165f82cc664aa2b67ae1a2d3019908f8834c8))
## [0.8.6](https://github.com/kittors/Lyra/releases/tag/v0.8.6) - 2026-08-29

### 新功能

- **agent**: support duration and throughput stats, bump version to 0.8.6 ([fdb5739](https://github.com/kittors/Lyra/commit/fdb57397a5f73ad86789054f546c3d74d7ef8fe3))
## [0.8.5](https://github.com/kittors/Lyra/releases/tag/v0.8.5) - 2026-08-29

### 新功能

- **release**: 发布 v0.8.5 并优化模型导入与发版中心交互 ([c21b641](https://github.com/kittors/Lyra/commit/c21b6413b9b1651508feb62ca5a7b3ca484029a3))

### 修复

- **desktop**: 修复渲染进程 turn-slice 引用 @lyra/core 根入口导致的打包外部化失败 ([39dd6ca](https://github.com/kittors/Lyra/commit/39dd6ca49cf285a0c6ad839a6cd455b1f8c1d835))
## [0.8.4](https://github.com/kittors/Lyra/releases/tag/v0.8.4) - 2026-08-28

### 新功能

- 精简流水线状态提示与实时读秒，支持供应商端点一键拉取模型 ([1731a9f](https://github.com/kittors/Lyra/commit/1731a9f97bbf20ab758e37841f00ff0601eb491f))
## [0.8.3](https://github.com/kittors/Lyra/releases/tag/v0.8.3) - 2026-08-28

### 新功能

- 优化流水线骨架屏与客户端缓存，重构发版中心弹窗 UI ([053b210](https://github.com/kittors/Lyra/commit/053b2102b35e793ec4ff68aa23071b2a2c27381a))
## [0.8.2](https://github.com/kittors/Lyra/releases/tag/v0.8.2) - 2026-08-28

### 新功能

- 优化流水线 UI、拖拽流畅度、耗时吞吐量及子 Agent 渲染 ([2a898f8](https://github.com/kittors/Lyra/commit/2a898f8a7c09eac1d0c293e52d8e59620e51ae9a))

### 性能

- 彻底根治长对话拖拽卡顿与滚屏白屏抖动 ([4d0136d](https://github.com/kittors/Lyra/commit/4d0136dacc09e7ba4bd59d3454cddf1f80831f29))
## [0.8.1](https://github.com/kittors/Lyra/releases/tag/v0.8.1) - 2026-08-28
