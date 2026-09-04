/**
 * 内建命令：名字和说明在这里，做什么由宿主实现。
 *
 * 这三条（`/compact` `/clear` `/commands`）此前写在 `Composer.tsx` 里——一个 React 组件。
 * 后果不是难看，是**只有那一个界面知道它们存在**：
 *
 *   `agent-cli` 里 `/compact` 不存在，而 CLI 会话同样会撑满上下文；
 *   设置 › 命令 那一页列不出它们，所以「有哪些命令可以用」这个问题，那一页给的是错的答案；
 *   任何第三个入口（脚本、ACP）想调用它们，得去读一个组件的源码。
 *
 * **名单在 core，执行在宿主。** `/clear` 在桌面端是开一个新窗口标签，在 CLI 里是清屏重来，
 * 而「有一个叫 clear 的命令、它的意思是开一个新对话」在两边是同一件事。所以这里给的是
 * `action` —— 一个宿主无关的动词，各自去实现它。
 *
 * 换个说法：core 拥有**词汇表**，宿主拥有**动作**。一个宿主没实现某个 action，那个命令在
 * 那里就不出现，而不是出现了按下去没反应。
 */

/** 宿主要实现的那几个动作。加一个之前先问：它在没有窗口的地方是什么意思？ */
export type CommandAction =
	/** 把之前的对话压缩成摘要。 */
	| "compact"
	/** 开一个新对话。 */
	| "clear"
	/** 打开命令管理界面。没有界面的宿主不实现它，于是不提供这条命令。 */
	| "manage-commands";

export interface BuiltinCommand {
	name: string;
	description: string;
	action: CommandAction;
}

/**
 * 内建命令的全集。
 *
 * 刻意很短。每加一条，`/` 菜单里就多一个跟用户自己写的命令抢名字的名字——而内建的永远赢
 * （见 `loadCommands` 的去重），所以一条内建命令的真实成本是「从此没人能用这个名字」。
 */
export const BUILTIN_COMMANDS: BuiltinCommand[] = [
	{ name: "compact", description: "把之前的对话压缩成摘要，腾出上下文", action: "compact" },
	{ name: "clear", description: "开一个新对话", action: "clear" },
	{ name: "commands", description: "管理斜杠命令，或新建一个", action: "manage-commands" },
];

/** 宿主实现了哪些动作，就提供哪些内建命令。 */
export function builtinCommandsFor(supported: readonly CommandAction[]): BuiltinCommand[] {
	const can = new Set(supported);
	return BUILTIN_COMMANDS.filter((command) => can.has(command.action));
}
