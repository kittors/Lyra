# ADR-0018：Electron fuses 暂不启用

- 状态：已采纳
- 日期：2026-09-03
- 相关：`packages/desktop/electron-builder.yml`、`packages/core/src/sandbox/backend.ts`

## 背景

Electron 的 fuses 是编译进二进制的一组开关，用来关掉几条内建的逃生通道：`ELECTRON_RUN_AS_NODE`、
`NODE_OPTIONS`、`--inspect`、以及从 asar 之外加载应用。加固清单里通常都有它。

它们是**一次性的**：一个版本发出去之后，其中某一位若是错的，只能靠发下一个版本盖掉，收不回来。

## 决定

**暂不启用。** 试过，没能验证，所以不交付。

`electronFuses:` 按文档写进 `electron-builder.yml` 之后：

- electron-builder 确实执行了它——打包日志里有 `executing @electron/fuses`
- 但打出来的包用 `@electron/fuses` 的 `getCurrentFuseWire` 读回去，八个位**全是关**，包括配成
  `true` 的 `runAsNode`、`enableCookieEncryption`、`enableEmbeddedAsarIntegrityValidation`
- 与此同时 `ELECTRON_RUN_AS_NODE=1 ./Lyra -e "..."` 仍然能起 Node

最后一条是关键：如果 `RunAsNode` 真的被关成了 `false`，那条命令会失败。它没有失败，说明那些位
根本没写进二进制，读到的「全关」是未初始化的默认值，而不是生效后的状态。

于是这个配置既没有带来保护，也没有办法确认它带来了什么。

## 后果

**保持现状**，并把上面这段结论写在 `electron-builder.yml` 里它本该在的位置——下一个想加固的人
第一眼就会看到，不必再走一遍。

**真要开，缺的是两件事**：查清 electron-builder 26.15.3 与 Electron 43 在 fuse wire 长度上的
对应关系（`the fuse wire in this version of Electron is not long enough` 是这一带已知的报错），
以及三平台各自读回验证——我只有 macOS 能验。

**`runAsNode` 无论如何要保持开着。** `core/src/sandbox/backend.ts` 用 `ELECTRON_RUN_AS_NODE=1`
加 `process.execPath` 起沙箱 runner，Windows 的受限令牌沙箱建在它上面。关掉它不是削弱沙箱，是
沙箱起不来——而沙箱是 fail-closed 的（ADR-0004），起不来就意味着每一条需要约束的命令都被拒绝。

## 为什么这条值得单独记

一个配置项写在那里、看起来正确、CI 也绿，是最容易被当成"已完成"的形态。这次它执行了、没报错、
产物也打出来了——只有实际读回二进制才发现什么都没发生。

**安全配置的验收是读回它的效果，不是确认它被写下来了。**
