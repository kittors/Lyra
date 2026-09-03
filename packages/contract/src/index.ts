/**
 * The boundary between the renderer and the main process.
 *
 * See `methods.ts` for what is here and why it is one file rather than three.
 */

export { CHANNELS, METHODS, REMOTE_METHODS, methodFor, type Method, type Reach } from "./methods.ts";

/*
 * `args.ts` 不在这里导出，要用它得走 `@lyra/contract/args`。
 *
 * 它需要 `node:path` 来判断绝对路径——那是这个仓库的一条硬规则，`risk.ts` 曾经自己拼分隔符
 * 判断，结果每一处这样的判断在 Windows 上都恒为假。而这个包入口是**渲染进程也会加载的**：
 * 手机在 WebView 里跑同一份 renderer，`services/host.ts` 从这里读方法表。一个 `node:` 导入
 * 混进来，Vite 会把它 externalize 成空壳，然后在第一次调用时炸掉整个页面。
 *
 * 所以分成两个入口：这里是「有什么方法、谁能调」，谁都能读；`./args` 是「参数长什么样」，
 * 只有主进程用得着，也只有主进程有 node。
 */
