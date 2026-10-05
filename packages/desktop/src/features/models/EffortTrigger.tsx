/**
 * 思考等级，在输入框那一行里的样子。
 *
 * 和 `ModelTrigger` 成对：一个说「谁来答」，一个说「答之前想多久」，两件事都是这条消息的属性，
 * 所以两枚控件也长一个样、排在一起。
 *
 * 抽出来是因为侧边聊天也要它。那个输入框此前只有模型可选，思考等级跟着主会话走且没法改——而它
 * 本来就是另一个对话，模型都能单独挑，想多久却挑不了。`sidechat.ts` 那边一直是支持的（`ask` 收
 * `{ thinking }`，不给才回落到主会话），缺的只是界面和中间那几层的传递。
 */

import { Brain, ChevronDown } from "lucide-react";
import { useI18n } from "../../i18n/index.ts";
import { RollingText } from "../../ui/motion/RollingText.tsx";
import { onPhone } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { useScopedMeta } from "../../app/session-scope.tsx";
import { usePopover } from "../../ui/overlay/Popover.tsx";
import { sessionThinking } from "../../lib/thinking.ts";
import { EffortMenu, effortLabel, type ThinkingSelection } from "./EffortMenu.tsx";
import { EffortMeter } from "./EffortMeter.tsx";
import { findModel } from "./models.ts";

export function EffortTrigger({
	modelId,
	ariaLabel,
	disabled,
	selection,
}: {
	/** 按哪个模型算档位名——同一个 `high` 在不同模型下叫的不一样。 */
	modelId: string | null | undefined;
	ariaLabel?: string;
	disabled?: boolean;
	/** 自己的一份等级；不给就是改屏幕上这个对话的。 */
	selection?: ThinkingSelection;
}) {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	// This screen's conversation: the live slot's `meta` is the focused screen's, and read from there
	// the button under the screen beside it named the focused conversation's effort.
	const meta = useScopedMeta();
	const menu = usePopover();
	const model = findModel(settings, modelId ?? null);
	const level = selection ? selection.value : sessionThinking(meta, settings);
	const label = effortLabel(level, model, t);
	return (
		<>
			<button
				type="button"
				onClick={menu.toggle}
				disabled={disabled}
				aria-haspopup="menu"
				aria-expanded={menu.open}
				aria-label={ariaLabel ?? t("composer.thinking", { level: label })}
				data-ly-tip={t("composer.thinking", { level: label })}
				className={`ly-composer-control flex shrink-0 items-center gap-1 rounded-lg px-1.5 text-label transition-colors disabled:opacity-60 ${
					menu.open ? "bg-card-hover text-ink" : "text-ink hover:bg-card-hover"
				}`}
			>
				{/* A phone draws the level rather than naming it, so the row is as wide in every language. */}
				{onPhone() ? (
					<EffortMeter level={level} model={model} />
				) : (
					<>
						<Brain size={16} className="shrink-0" aria-hidden />
						<RollingText>{label}</RollingText>
						<ChevronDown size={14} className="shrink-0 text-ink-muted" aria-hidden />
					</>
				)}
			</button>
			{menu.open && !disabled && <EffortMenu anchor={menu.anchor} onClose={menu.close} selection={selection} />}
		</>
	);
}
