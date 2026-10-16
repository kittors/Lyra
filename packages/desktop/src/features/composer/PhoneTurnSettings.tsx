/**
 * What the model's sheet carries on a phone: how hard it thinks, how it asks, what draws for it.
 *
 * On the desktop these are three controls in the composer's row beside the model — a mark for the
 * approval mode, a meter for the effort, a wand for the image and video models — and each opens a
 * menu of its own. A phone's row has room for the attachment, the model and send; three more marks
 * to learn and aim at were what made it read as a toolbar. They are all about how this turn will be
 * answered, which is what the model's sheet is about, so that is where they went.
 *
 * The effort is the one changed often, so its choices are right there in a row. The approval mode
 * and the media models are set once and left: each is a row saying what it is set to, opening its
 * own sheet over this one. Full access keeps its red wherever it is shown, here and on the model's
 * chip (`PhoneTurnBadge`) — it is the one setting that must never be quietly on.
 */

import { resolveThinkingOption } from "@lyra/core/thinking-options";
import { ChevronRight, CircleAlert, Hand, SquareTerminal } from "lucide-react";
import { useRef } from "react";
import { useScopedMeta, useScopedSessionId } from "../../app/session-scope.tsx";
import { useI18n } from "../../i18n/index.ts";
import { haptic } from "../../mobile/haptics.ts";
import { sessionThinking } from "../../lib/thinking.ts";
import { useApp } from "../../store/index.ts";
import { MenuItem } from "../../ui/overlay/Menu.tsx";
import { usePopover, type Anchor } from "../../ui/overlay/Popover.tsx";
import { EffortMeter, effortLabel, findModel, localizedThinkingOptions, MediaModelRow } from "../models/index.ts";

export function PhoneTurnSettings({
	permission: picker,
}: {
	/**
	 * The approval mode's own sheet, drawn by the composer that owns it.
	 *
	 * Passed in rather than imported: the modals' front door leads back to the conversation and from
	 * there to this composer, a cycle. Rendered here, inside this sheet, so it stacks over it — a
	 * popover drawn anywhere else would close this one as it opened.
	 */
	permission: (anchor: Anchor, onClose: () => void) => React.ReactNode;
}) {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const setThinking = useApp((s) => s.setThinking);
	const sessionId = useScopedSessionId();
	const meta = useScopedMeta();
	const permission = usePopover();
	const permissionRow = useRef<HTMLDivElement>(null);
	const model = findModel(settings, meta?.modelId ?? settings?.defaultModelId);
	const options = model?.supportsThinking === false ? [] : localizedThinkingOptions(model ?? undefined, t);
	const resolved = resolveThinkingOption(sessionThinking(meta, settings), model ?? undefined);
	const mode = settings?.permissionMode ?? "auto";
	const Mark = mode === "ask" ? Hand : mode === "full" ? CircleAlert : SquareTerminal;
	const modeLabel = t(mode === "ask" ? "composer.permissionAsk" : mode === "full" ? "composer.permissionFull" : "composer.permissionAuto");

	return (
		<div className="ly-phone-turn">
			{options.length > 1 && (
				<div className="ly-phone-turn-effort">
					<div className="ly-phone-turn-label">
						<span>{t("thinking.title")}</span>
						<span className="ly-phone-turn-note">{t("thinking.currentOnly")}</span>
					</div>
					<div role="radiogroup" aria-label={t("thinking.title")} className="ly-phone-options">
						{options.map((option) => (
							<button
								key={option.id}
								type="button"
								role="radio"
								aria-checked={option.id === resolved?.id}
								onClick={() => {
									// Felt as well as seen: a choice from a row of them, the way a phone's pickers answer.
									if (option.id !== resolved?.id) haptic("selection");
									void setThinking(option.id, sessionId, true);
								}}
								className="ly-phone-option ly-press"
							>
								{option.label}
							</button>
						))}
					</div>
				</div>
			)}

			{/* The row is the anchor: a sheet opened from a sheet stacks over it, and a tap does not focus a button in WebKit. */}
			<div ref={permissionRow}>
			<MenuItem
				icon={<Mark size={16} strokeWidth={1.8} className={mode === "full" ? "text-danger" : undefined} />}
				trailing={
					<span className={`ly-phone-turn-value ${mode === "full" ? "text-danger" : ""}`}>
						{modeLabel}
						<ChevronRight size={15} strokeWidth={2} aria-hidden className="shrink-0 text-ink-faint" />
					</span>
				}
				onClick={() => {
					if (permissionRow.current) permission.openAt(permissionRow.current);
				}}
			>
				{t("permission.mode")}
			</MenuItem>
			</div>
			<MediaModelRow />
			{permission.open && picker(permission.anchor, permission.close)}
		</div>
	);
}

/**
 * What the model's chip says besides the name on a phone: the effort, drawn, and a red dot while
 * full access is on — the two things that used to have chips of their own beside it.
 */
export function PhoneTurnBadge() {
	const settings = useApp((s) => s.settings);
	const meta = useScopedMeta();
	const model = findModel(settings, meta?.modelId ?? settings?.defaultModelId);
	const full = settings?.permissionMode === "full";
	return (
		<span className="ly-phone-turn-badge">
			{model?.supportsThinking !== false && <EffortMeter level={sessionThinking(meta, settings)} model={model} />}
			{full && <span aria-hidden className="ly-phone-turn-danger" />}
		</span>
	);
}

/**
 * The chip's name on a phone, for assistive technology: the model's action, and what the badge draws.
 *
 * The effort had a button of its own with its level in its label; drawn inside the model's chip, the
 * chip's label is the only thing a screen reader reads, so it says the level — and full access.
 */
export function usePhoneTurnLabel(): string {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const meta = useScopedMeta();
	const model = findModel(settings, meta?.modelId ?? settings?.defaultModelId);
	const parts = [t("composer.selectModel")];
	if (model?.supportsThinking !== false) parts.push(t("composer.thinking", { level: effortLabel(sessionThinking(meta, settings), model, t) }));
	if (settings?.permissionMode === "full") parts.push(t("composer.permissionFull"));
	return parts.join(" · ");
}
