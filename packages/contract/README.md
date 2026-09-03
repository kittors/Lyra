# @lyra/contract

渲染进程与主进程之间那条线，写下来一次。

## 为什么是一个包

同一件事本来有三处描述，互相之间没有共同来源：

| 文件 | 说的是 |
| --- | --- |
| `desktop/electron/ipc-types.ts` | 方法的类型签名 |
| `desktop/electron/preload.ts` | 方法名到 channel 名的映射 |
| `desktop/electron/sync-rpc.ts` | 手机能调哪些 |

加一个方法要改三处。漏掉哪一处，表现各不相同：漏 preload 是
`undefined is not a function`；**漏 sync-rpc 是手机上静默失效**——界面在，点了没反应，没有报错。

放在 `desktop/electron/` 下也能解决前两处，但第三个消费者（以及将来渲染进程的 service 层）就要
反向依赖主进程的内部目录。独立成包最省事。

## 里面有什么

`src/methods.ts` 是那份清单。每个方法一行，写明：

- **channel**：IPC 通道名。它只在这里出现一次，所以拼错是不可能的。
- **remote**：手机能不能调，以及**为什么**。`false` 的理由要写出来——这是安全边界，读它的人
  需要知道那不是「忘了加」。

## 边界

这个包**不依赖任何东西**。它有三个消费者，依赖谁就把谁拖进另外两个的构建里。
`pnpm arch` 守着这一条。
