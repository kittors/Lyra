# ADR-0006：macOS 用自签名证书，不用 ad-hoc

- 状态：已采纳
- 日期：2026-09-03（追记）
- 相关：`packages/desktop/electron-builder.yml`、`packages/desktop/scripts/make-signing-cert.sh`

## 背景

没有 Apple 开发者账号就没有 Developer ID，也就没有公证。看起来剩下的选择只有 ad-hoc 签名或者
干脆不签。

两个都有问题，而且不是同一个问题。

**ad-hoc 的问题**：macOS 判断「两个构建是不是同一个应用」看的是 designated requirement。
ad-hoc 之下它是可执行文件的哈希：

```
designated => cdhash H"ff1c876598ea614d4bc7fead3bb1c0d9c2c710a7"
```

每次发版都改变二进制，所以每次发版都是一个陌生人：录屏权限被撤销、钥匙串条目读不出来、所有
授权重来一遍。

**不签的问题更糟**。Electron 的二进制到手时是 linker-signed 并声明了 sealed resources；
electron-builder 把它改名、重写 Info.plist、把我们的资源塞在旁边，跳过签名就没有任何东西重新
封装这些。`codesign --verify` 说得很直白：

```
code has no resources but signature indicates they must be present
```

带着隔离标记时，Gatekeeper 认定签名损坏并报「Lyra.app 已损坏，无法打开。」——那个对话框**没有
「仍要打开」**。死路一条。

## 决定

用自签名证书（`make-signing-cert.sh` 不需要 Apple 账号就能生成）。designated requirement 于是
指向证书：

```
designated => identifier "dev.lyra.app" and certificate leaf = H"…"
```

它对可执行文件只字不提，所以更新之后仍然是同一个应用。用一张证书签两个毫不相干的二进制验证
过：requirement 逐字节相同。

## 后果

**买到的**：更新不再重置权限。

**没买到的**：公证。从浏览器下载的首次安装仍然会遇到「未识别的开发者」——但更新不会，因为它是
就地替换 bundle，从不带隔离标记。

`electron-builder.yml` 里 `identity: "-"` 仍然写着，作为地板而不是意图：`scripts/package.mjs`
在有真实身份时替换它。留着是因为「跳过签名」比它听起来严重得多，见上。
