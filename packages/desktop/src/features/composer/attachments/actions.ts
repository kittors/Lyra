/**
 * 拿一份附件去做点什么：打开它、指出它在哪、把路径抄下来。
 *
 * 抽在这里是因为有两个入口要做同一件事——格子上的双击，和菜单里的那几行。两份实现的话，「先确认
 * 文件还在」这种只在出错时才看得出来的一步，迟早只剩一份有。
 *
 * 这一层不画任何东西，只有行为和它的前置判断。
 */

import { useCallback, useMemo } from "react";

import { abilitiesOf, type Abilities } from "./display.ts";
import { bridge } from "../../../services/index.ts";
import { useApp } from "../../../store/index.ts";
import { useI18n } from "../../../i18n/index.ts";
import { useOpenTarget } from "../../../store/open-targets.ts";

/** 动作要认识这份附件的哪几件事。 */
export interface ActionTarget {
	/** 屏幕上叫什么——出错的那句话里用它，而不是用一串路径。 */
	name: string;
	path?: string;
}

export interface AttachmentActions {
	/** 这一份在这台机器上能被怎么处置。 */
	abilities(path: string | undefined): Abilities;
	/** 「用什么打开」当前指向的那个应用，标签由 `openLabel` 给。 */
	target: ReturnType<typeof useOpenTarget>;
	/** 交给外部应用。 */
	openExternal(file: ActionTarget): void;
	/** 在这个平台的文件管理器里指出它。 */
	reveal(file: ActionTarget): void;
	/**
	 * 文件还在原处吗——动手之前问一句，不在就说出来。
	 *
	 * 给的是问句而不是「打开到面板」那个动作：把一份文件放进右边的面板要惊动 dock，而 dock 的门
	 * 后面挂着整棵面板树，最终会绕回这个域——`pnpm arch` 管这叫循环依赖，它是对的。所以那件事留
	 * 给本来就有这条边的调用方去做，这里只把它们共用的那一问交出去。
	 */
	ensureThere(file: ActionTarget): Promise<boolean>;
	/** 路径进剪贴板。 */
	copyPath(file: ActionTarget): void;
}

export function useAttachmentActions(): AttachmentActions {
	const { t } = useI18n();
	const target = useOpenTarget();
	const projects = useApp((s) => s.settings?.projects);
	const roots = useMemo(() => projects?.map((project) => project.path) ?? [], [projects]);

	/**
	 * 动手之前先确认文件还在。
	 *
	 * 转录活得比文件久，这是设计使然：一条消息记下的是发送那一刻的位置，之后文件会被改名、挪走、
	 * 清掉。少了这一问，「在访达中显示」在文件已经不在时会去打开它的上级目录——看起来像是显示错了
	 * 文件，而不是文件没了。
	 *
	 * 不能用 `files.exists`：那个按已打开的项目解析路径，项目外一律答 false，而附件绝大多数来自
	 * 项目外。见 `system:pathExists`。
	 */
	const withFile = useCallback(
		async (file: ActionTarget, act: (path: string) => void | Promise<void>) => {
			if (!file.path) return;
			const here = await bridge.system.pathExists(file.path).catch(() => false);
			if (!here) {
				useApp.getState().notify(t("attachment.gone", { name: file.name }), "warn");
				return;
			}
			await act(file.path);
		},
		[t],
	);

	return useMemo(
		() => ({
			abilities: (path: string | undefined) => abilitiesOf(path, roots),
			target,
			openExternal: (file) => void withFile(file, (path) => bridge.system.openIn(target.id, path)),
			reveal: (file) => void withFile(file, (path) => bridge.system.openIn("reveal", path)),
			ensureThere: async (file) => {
				let here = false;
				await withFile(file, () => {
					here = true;
				});
				return here;
			},
			copyPath: (file) => {
				if (!file.path) return;
				// 复制不碰磁盘，所以这一个不必先问文件还在不在：人要的就是那串字。
				void bridge.clipboard.write(file.path);
				useApp.getState().notify(t("attachment.pathCopied"), "info");
			},
		}),
		[roots, target, withFile, t],
	);
}
