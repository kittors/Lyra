import type { PermissionMode } from "@lyra/core";
import { Folder, Terminal, Globe,
	Check,
	CircleAlert,
	Hand,
	SquareTerminal,
	TriangleAlert,
} from "lucide-react";
import { useState } from "react";

import {
	MenuBody,
	MenuItem,
	MenuLabel,
	Popover,
	type Anchor,
} from "../../ui/overlay/Popover.tsx";
import { DialogFrame, DialogAction } from "../../ui/overlay/Dialog.tsx";
import { Overlay } from "../../ui/overlay/Overlay.tsx";
import { useApp } from "../../store/index.ts";
import { useI18n, type MessageKey } from "../../i18n/index.ts";

const MODES: {
	value: PermissionMode;
	icon: typeof Hand;
	titleKey: MessageKey;
	detailKey: MessageKey;
	danger?: boolean;
}[] = [
	{
		value: "ask",
		icon: Hand,
		titleKey: "composer.permissionAsk",
		detailKey: "permission.askDetail",
	},
	{
		value: "auto",
		icon: SquareTerminal,
		titleKey: "composer.permissionAuto",
		detailKey: "permission.autoDetail",
	},
	{
		value: "full",
		icon: CircleAlert,
		titleKey: "general.fullAccess",
		detailKey: "permission.fullDetail",
		danger: true,
	},
];

/**
* Permission mode, anchored to the chip that shows it.
*
* It was a centred dialog, which read as a decision about the whole app rather than a setting
* attached to the control right there in the composer — the same reason the model and effort
* menus hang off their own chips.
*/
export function PermissionPicker({
	anchor,
	onClose,
}: {
	anchor: Anchor;
	onClose: () => void;
}) {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const current = settings?.permissionMode ?? "auto";
	const [confirming, setConfirming] = useState(false);

	function choose(mode: PermissionMode) {
		if (!settings) return;
		void saveSettings({ ...settings, permissionMode: mode });
		onClose();
	}

	return (
		<>
			{!confirming && (
				<Popover
					anchor={anchor}
					onClose={onClose}
					placement="top"
					align="start"
					width="wide"
					label={t("permission.mode")}
				>
					<MenuBody>
						<MenuLabel>{t("permission.question")}</MenuLabel>
						{MODES.map((mode) => (
							<MenuItem
								key={mode.value}
								icon={
									<mode.icon
										size={13}
										strokeWidth={1.8}
										className={mode.danger ? "text-danger" : undefined}
									/>
								}
								detail={t(mode.detailKey)}
								selected={current === mode.value}
								trailing={
									current === mode.value ? (
										<Check
											size={13}
											strokeWidth={2.2}
											className={`mt-[3px] shrink-0 ${mode.danger ? "text-danger" : ""}`}
										/>
									) : undefined
								}
								onClick={() => {
									/*
									* Turning full access on is asked about once, deliberately.
									*
									* Every other row here narrows what happens without asking; this one
									* removes the asking entirely, for the file system and the network
									* both. A setting that consequential should not be one stray click
									* away — and the click that reaches it is usually aimed at the row
									* above.
									*/
									if (mode.danger && current !== mode.value)
										setConfirming(true);
									else choose(mode.value);
								}}
							>
								{/* Full access keeps its colour even though every other row is plain ink: it is
						    the one setting that must never be quietly on. */}
								<span className={mode.danger ? "text-danger" : undefined}>
									{t(mode.titleKey)}
								</span>
							</MenuItem>
						))}
					</MenuBody>
				</Popover>
			)}

			{confirming && (
				<Overlay
					onClose={() => { setConfirming(false); onClose(); }}
					returnFocus={anchor instanceof HTMLElement ? anchor : undefined}
					width={480}
				>
					{(dismiss) => <DialogFrame
						icon={<TriangleAlert size={20} className="shrink-0 text-danger" />}
						title={t("permission.confirmTitle")}
						detail={t("permission.confirmSummary")}
						actions={(
							<>
								<div className="flex-1" />
								<DialogAction onClick={() => dismiss()}>{t("common.cancel")}</DialogAction>
								<DialogAction tone="danger" onClick={() => dismiss(() => { setConfirming(false); choose("full"); })}>{t("permission.confirmEnable")}</DialogAction>
							</>
						)}
					>
						<div className="rounded-2xl bg-card px-4 py-1">
							{[
								{ icon: <Folder size={23} className="text-accent" />, title: t("permission.files"), detail: t("permission.filesDetail") },
								{ icon: <Terminal size={23} className="text-ink-muted" />, title: t("permission.terminal"), detail: t("permission.terminalDetail") },
								{ icon: <Globe size={23} className="text-accent" />, title: t("permission.network"), detail: t("permission.networkDetail") },
							].map((item) => (
								<div key={item.title} className="flex items-center gap-3 py-3">
									<span className="shrink-0">{item.icon}</span>
									<div>
										<p className="text-label font-medium text-ink">{item.title}</p>
										<p className="mt-0.5 text-detail leading-relaxed text-ink-muted">{item.detail}</p>
									</div>
								</div>
							))}
						</div>
						<p className="mt-4 text-detail leading-relaxed text-ink-faint">{t("permission.risk")}</p>
					</DialogFrame>}
				</Overlay>
			)}
		</>
	);
}
