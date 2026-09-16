/**
 * `zprint-clj` 没有自带类型。
 *
 * 它是 zprint 的 ClojureScript 构建产物——一个编译出来的 `.js`，不会有 `.d.ts`。声明写在这里而
 * 不是塞一个 `any`：签名是实测出来的（`fn(源码, 选项)`，传一个参数会抛 `Invalid arity: 1`），
 * 写下来下一个人就不用再试一遍。
 */
declare module "zprint-clj" {
	const format: (source: string, options: Record<string, unknown>) => string;
	export default format;
}
