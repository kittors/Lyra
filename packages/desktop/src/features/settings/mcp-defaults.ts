/**
 * 手动添加的 MCP 服务，刚建出来的样子。
 *
 * 单独一个小文件：设置页的 ⋯ 和市场页的 ⋯ 都能「添加 MCP 服务器」，两处要产出同一个东西；而市场页
 * 从设置域拿它时不该把整张 MCP 设置页一起拉进自己的包里。
 */

import type { McpServerConfig } from "@lyra/core";
import { translate } from "../../i18n/index.ts";

/**
 * A blank server of the given kind, ready to be edited.
 *
 * Exported because adding one is offered from the page's own ⋯ and from the market's, and the two
 * must produce the same thing — a second copy of these defaults would drift the first time one of
 * them was corrected.
 */
export function newMcpServer(transport: "stdio" | "http"): McpServerConfig {
	const id = `mcp-${Date.now().toString(36)}`;
	return transport === "stdio"
		? { id, name: translate("mcp.newStdio"), transport: "stdio", command: "npx", args: [], enabled: true }
		: { id, name: translate("mcp.newHttp"), transport: "http", url: "https://", enabled: true };
}
