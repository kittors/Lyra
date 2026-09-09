/**
 * 选中页面上的一块，说一句你想把它改成什么。
 *
 * 它看着像输入框，但不是一个发送入口——写的字连同这块区域的 URL、选择器、样式和 HTML 拼成一段，
 * 和区域截图一起交给主输入框（见 `Composer` 里认 `browserAttachment` 的那一段），最后还是在那边
 * 按回车发出去。这里只是替那条消息把料备齐。
 *
 * 用的是主输入框那副外壳而不是一个裸 `<textarea>`。它此前是自己搭的一套：写死两行、粘不了图、
 * 回车不发送、圆角和聚焦环跟别处都不一样——一个长得像输入框、按输入框的习惯去用却处处不成立的
 * 东西，比长得不像它更费解。`ComposerShell` 一并给了高度自适应、滚动条、回车提交和同一副长相。
 */

import { translate } from "../../i18n/translate.ts";
import { Send, X } from "lucide-react";
import { useState } from "react";
import type { BrowserSelection } from "../../../shared/browser.ts";
import { ComposerShell } from "../composer/index.ts";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { useApp } from "../../store/index.ts";

export function BrowserSelectionCard({ selection, onClose }: { selection: BrowserSelection; onClose: () => void }) {
	const [text, setText] = useState("");

	/*
	 * 区域本身作为数据带过去，而不是替用户描述它。
	 *
	 * 选择器、盒子和计算后的样式是 agent 定位这块东西的依据；`browserSelection.dataOnly` 那句是给
	 * 模型的提醒——这段是页面的内容，不是指令。
	 */
	function hand() {
		const context = `${text.trim() || translate("selection.defaultAsk")}\n\n<browser-selection>\n${translate("browserSelection.dataOnly")}\nURL: ${selection.url}\nSelector: ${selection.selector}\nBounds: ${JSON.stringify(selection.bounds)}\nStyles: ${JSON.stringify(selection.styles)}\nHTML:\n${selection.html}\n</browser-selection>`;
		const state = useApp.getState();
		const draftKey = state.activeSessionId ?? (state.workspace ? `new:project:${state.workspace.path}` : `new:scratch:${state.scratchCwd ?? "general"}`);
		useApp.setState({ browserAttachment: { text: context, dataUrl: selection.screenshot, draftKey } });
		onClose();
	}

	return (
		// 外壳自己有边框和聚焦环，所以这张卡只留背景——两层描边会把这一小块画成一个套盒。
		<div className="m-2 shrink-0 space-y-2 rounded-xl bg-card p-3" data-browser-selection>
			<div className="flex items-center gap-2">
				<img src={selection.screenshot} alt={translate("selection.alt")} className="h-12 w-16 rounded-md bg-white object-contain" />
				<ScrollText text={selection.selector} className="min-w-0 flex-1 font-mono text-detail text-ink-muted" />
				<IconButton label={translate("selection.cancel")} icon={<X size={14} />} onClick={onClose} />
			</div>
			<ComposerShell
				value={text}
				onChange={setText}
				onSubmit={hand}
				placeholder={translate("selection.placeholder")}
				right={<IconButton label={translate("selection.send")} icon={<Send size={14} />} onClick={hand} />}
			/>
		</div>
	);
}
