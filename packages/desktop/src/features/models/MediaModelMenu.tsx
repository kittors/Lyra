/**
 * Which image and video model this conversation uses, from the composer's button.
 *
 * Two short lists rather than the chat menu with a second mode: a conversation usually has a handful
 * of these at most, and what matters is seeing both at once — what draws, what films — and what each
 * falls back to. Each section has the default at the top (followed when nothing is picked here), the
 * models, and, once a pick differs from the default, a row to make it the default.
 *
 * A pick is the conversation's (`SessionMeta.imageModelId` / `videoModelId`), the same place a named
 * drawing or an `@` in a message puts it. On the blank screen there is no conversation to hold it, so
 * the pick is the default itself — the model the next conversation starts from, as with the chat model.
 */

import { Box, ChevronRight, Clapperboard, Palette, Star } from "lucide-react";
import { MEDIA_KINDS, type MediaKind, mediaModelRows, resolveMediaModel } from "@lyra/core/image-models";
import { useScopedMeta, useScopedSessionId } from "../../app/session-scope.tsx";
import { useI18n } from "../../i18n/index.ts";
import { ambiguousNames, groupModels } from "../../lib/model-grouping.ts";
import { useApp } from "../../store/index.ts";
import { RollingText } from "../../ui/motion/RollingText.tsx";
import { MenuBody, MenuFooter, MenuItem, MenuLabel, MenuSeparator, Popover, type Anchor } from "../../ui/overlay/Popover.tsx";
import { ModelItem } from "./ModelMenu.tsx";

const ICONS: Record<MediaKind, typeof Palette> = { image: Palette, video: Clapperboard };

export function MediaModelMenu({ anchor, onClose }: { anchor: Anchor; onClose: () => void }) {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const setMediaModel = useApp((s) => s.setMediaModel);
	const saveSettings = useApp((s) => s.saveSettings);
	const setView = useApp((s) => s.setView);
	const setSection = useApp((s) => s.setSettingsSection);
	const sessionId = useScopedSessionId();
	const meta = useScopedMeta();
	const providers = settings?.providers;
	const kinds = MEDIA_KINDS.filter((kind) => mediaModelRows(providers, kind).length > 0);

	const choose = (kind: MediaKind, modelId: string | null) => {
		void setMediaModel(kind, modelId, sessionId).catch(() => {});
		onClose();
	};

	return (
		<Popover
			anchor={anchor}
			onClose={onClose}
			placement="top"
			align="start"
			width="wide"
			label={t("mediaMenu.button")}
			footer={
				<MenuFooter>
					<p className="px-2 pb-1 text-caption text-ink-faint">{meta ? t("mediaMenu.hint") : t("mediaMenu.hintNew")}</p>
					<MenuItem
						trailing={<ChevronRight size={13} strokeWidth={2} className="shrink-0 text-ink-faint" />}
						onClick={() => {
							setView("settings");
							setSection("models");
							onClose();
						}}
					>
						<RollingText>{t("modelMenu.manageProviders")}</RollingText>
					</MenuItem>
				</MenuFooter>
			}
		>
			<MenuBody>
				{kinds.map((kind, at) => {
					const Icon = ICONS[kind];
					const groups = groupModels(providers, kind);
					const rows = groups.flatMap((group) => group.models.map((model) => ({ provider: group.provider, model })));
					const clashes = ambiguousNames(groups);
					const preferred = kind === "video" ? settings?.videoModelId : settings?.imageModelId;
					const stored = meta ? (kind === "video" ? meta.videoModelId : meta.imageModelId) : preferred;
					const pick = resolveMediaModel(providers, kind, meta ? { session: stored, preferred } : { preferred: stored });
					// What "the default" is right now, for the row that follows it: the setting, else the first.
					const fallback = resolveMediaModel(providers, kind, { preferred });
					const picked = pick.row && (pick.source === "session" || (!meta && pick.source === "default")) ? pick.row.model.id : null;
					const stale = pick.row && pick.stale?.includes(meta ? "session" : "default") ? stored : null;
					return (
						<div key={kind} data-ly-media-kind={kind}>
							{at > 0 && <MenuSeparator />}
							<MenuLabel>
								<span className="flex items-center gap-1.5">
									<Icon size={12} strokeWidth={2} aria-hidden />
									{kind === "video" ? t("mediaMenu.videoSection") : t("mediaMenu.imageSection")}
								</span>
							</MenuLabel>
							<MenuItem
								icon={<Box size={14} />}
								selected={!picked}
								className="ly-model-row"
								detail={
									meta
										? fallback.row && t(preferred && fallback.source === "default" ? "mediaMenu.followDetail" : "mediaMenu.followAuto", { name: fallback.row.model.name })
										: rows[0] && t("mediaMenu.followAuto", { name: rows[0].model.name })
								}
								onClick={() => choose(kind, null)}
							>
								{meta ? t("mediaMenu.followDefault") : kind === "video" ? t("agents.videoModelAuto") : t("agents.imageModelAuto")}
							</MenuItem>
							<div className="flex flex-col gap-0.5">
								{rows.map((row) => (
									<ModelItem
										key={row.model.id}
										row={row}
										selected={picked === row.model.id}
										showProvider={clashes.has(row.model.name.trim().toLowerCase())}
										numbered={false}
										shortcut={null}
										onChoose={() => choose(kind, row.model.id)}
									/>
								))}
							</div>
							{stale && <p className="px-3 py-1 text-caption text-ink-muted">{t("mediaMenu.stale", { name: stale.split("/").pop() ?? stale })}</p>}
							{meta && picked && settings && picked !== preferred && (
								<MenuItem
									icon={<Star size={13} strokeWidth={1.8} />}
									onClick={() => {
										void saveSettings({ ...settings, [kind === "video" ? "videoModelId" : "imageModelId"]: picked }).catch(() => {});
										onClose();
									}}
								>
									{kind === "video" ? t("providerModels.makeDefaultVideo") : t("providerModels.makeDefaultImage")}
								</MenuItem>
							)}
						</div>
					);
				})}
			</MenuBody>
		</Popover>
	);
}
