/**
 * Where the catalogue gets its listings from.
 *
 * A registry is one JSON file at a URL naming bundles and where to clone them — there is no
 * service to run and no format to adopt, which is why the collections that already exist can be
 * added as they are. Several can be configured at once and the catalogue shows them merged,
 * because from the page's side the question is "what can I install", not "who published it".
 *
 * Its own dialog rather than a section of the settings page: adding a source is something you do
 * from an empty catalogue, at the moment you notice it is empty, and sending someone to settings
 * and back to answer that is three screens for one line of text.
 */

import { translate } from "../../i18n/translate.ts";
import { useI18n } from "../../i18n/index.ts";
import { Plus, CircleAlert, Library } from "lucide-react";
import { useState } from "react";

import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { RowDeleteButton } from "../../ui/primitives/RowDeleteButton.tsx";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { DialogAction, DialogFrame } from "../../ui/overlay/Dialog.tsx";
import { Overlay } from "../../ui/overlay/Overlay.tsx";
import { GhostButton } from "../settings/index.ts";
import { TextInput } from "../settings/index.ts";
import { useApp } from "../../store/index.ts";

export function RegistrySources({
	sources,
	errors,
	onClose,
}: {
	sources: string[];
	/** Which of them failed on the last read, so a bad one can be removed rather than just sitting there. */
	errors: { url: string; message: string }[];
	onClose: () => void;
}) {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const [adding, setAdding] = useState("");
	const confirm = useConfirmer();

	const add = () => {
		const url = adding.trim();
		if (!settings || !url) return;
		if (sources.includes(url)) return setAdding("");
		void saveSettings({ ...settings, pluginRegistries: [...sources, url] });
		setAdding("");
	};

	const remove = (url: string) => {
		if (!settings) return;
		void saveSettings({ ...settings, pluginRegistries: sources.filter((u) => u !== url) });
	};

	return (
		<Overlay onClose={onClose} width={520}>{(dismiss) => (
			<DialogFrame
				icon={<Library size={20} className="shrink-0 text-accent" />}
				title={translate("registry.title")}
				detail={t("registry.intro")}
				actions={(
					<>
						<div className="flex-1" />
						{/* 这张卡片改的东西是即时存盘的，所以出口只有一个，写着「完成」而不是「取消」。 */}
						<DialogAction tone="primary" onClick={() => dismiss()}>{translate("common.done")}</DialogAction>
					</>
				)}
			>
				<div className="flex flex-col gap-1.5">
					{sources.map((url) => {
						const failed = errors.find((e) => e.url === url);
						return (
							<div key={url} data-row-actions className="ly-scroll flex items-center gap-2 rounded-lg bg-card px-3 py-2 text-detail">
								<span className={`min-w-0 flex-1 font-mono ${failed ? "text-danger" : "text-ink-faint"}`}>
									<ScrollText text={url} />
								</span>
								{failed && <button type="button" aria-label={t("registry.readFailed")} data-ly-tip={failed.message} className="shrink-0 text-danger"><CircleAlert size={14} /></button>}
								<RowDeleteButton
									label={t("registry.removeOne", { url })}
									onClick={() =>
										confirm.ask({
											title: t("registry.removeConfirm"),
											detail: t("registry.removeDetail"),
											confirmLabel: t("common.remove"),
											onConfirm: () => remove(url),
										})
									}
								/>
							</div>
						);
					})}

					<div className="flex items-center gap-2 pt-1">
						<TextInput
							value={adding}
							onChange={setAdding}
							onKeyDown={(event) => event.key === "Enter" && add()}
							placeholder="https://…/registry.json"
							mono
							className="h-[30px] flex-1 text-detail"
						/>
						<GhostButton onClick={add} icon={<Plus size={12} strokeWidth={2} />} title={t("mcp.add")} />
					</div>

					{confirm.element}
				</div>
			</DialogFrame>
		)}</Overlay>
	);
}
