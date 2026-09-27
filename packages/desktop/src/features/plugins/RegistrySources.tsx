/**
 * Where the catalogue gets its listings from.
 *
 * A registry is one JSON file at a URL naming bundles and where to get them — there is no service to
 * run and no format to adopt, which is why collections that already exist can be added as they are.
 * Several can be configured at once and the catalogue shows them merged, because from the page's
 * side the question is "what can I install", not "who published it".
 *
 * Settings keeps two lists, `pluginRegistries` and `skillRegistries`, and this dialog used to be
 * handed the two joined into one and write that back as the first — so removing any source turned
 * the skill index into a plugin index as well, and it was then fetched twice. Each row now knows
 * which list it is in, and adding goes into the plugin list: an index says what each of its entries
 * is, so which list the address sits in only decides nothing that matters.
 */

import { translate } from "../../i18n/translate.ts";
import { useI18n } from "../../i18n/index.ts";
import { CircleAlert, Library, Plus } from "lucide-react";
import { useState } from "react";

import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { RowDeleteButton } from "../../ui/primitives/RowDeleteButton.tsx";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { DialogAction, DialogFrame } from "../../ui/overlay/Dialog.tsx";
import { Overlay } from "../../ui/overlay/Overlay.tsx";
import { Button } from "../../ui/primitives/Button.tsx";
import { TextInput } from "../settings/index.ts";
import { useApp } from "../../store/index.ts";

export function RegistrySources({
	errors,
	onClose,
}: {
	/** Which of them failed on the last read, so a bad one can be removed rather than just sitting there. */
	errors: { url: string; message: string }[];
	onClose: () => void;
}) {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const [adding, setAdding] = useState("");
	const confirm = useConfirmer();

	const plugins = settings?.pluginRegistries ?? [];
	const skills = settings?.skillRegistries ?? [];
	const rows = [...plugins.map((url) => ({ url, list: "plugin" as const })), ...skills.map((url) => ({ url, list: "skill" as const }))];
	const invalid = adding.trim() !== "" && !/^https:\/\//i.test(adding.trim());

	const add = () => {
		const url = adding.trim();
		if (!settings || !url || invalid) return;
		if (plugins.includes(url) || skills.includes(url)) return setAdding("");
		void saveSettings({ ...settings, pluginRegistries: [...plugins, url] });
		setAdding("");
	};

	const remove = (url: string, list: "plugin" | "skill") => {
		if (!settings) return;
		void saveSettings(
			list === "plugin"
				? { ...settings, pluginRegistries: plugins.filter((u) => u !== url) }
				: { ...settings, skillRegistries: skills.filter((u) => u !== url) },
		);
	};

	return (
		<Overlay onClose={onClose} width={540}>{(dismiss) => (
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
					{rows.map(({ url, list }) => {
						const failed = errors.find((e) => e.url === url);
						return (
							<div key={`${list}:${url}`} data-row-actions className="ly-scroll flex items-center gap-2 rounded-lg bg-card px-3 py-2 text-detail">
								<span className={`min-w-0 flex-1 font-mono ${failed ? "text-danger" : "text-ink-muted"}`}>
									<ScrollText text={url} />
								</span>
								{list === "skill" && <span className="shrink-0 text-caption text-ink-faint">{t("common.skills")}</span>}
								{failed && <button type="button" aria-label={t("registry.readFailed")} data-ly-tip={failed.message} className="shrink-0 text-danger"><CircleAlert size={14} /></button>}
								<RowDeleteButton
									label={t("registry.removeOne", { url })}
									onClick={() =>
										confirm.ask({
											title: t("registry.removeConfirm"),
											detail: t("registry.removeDetail"),
											confirmLabel: t("common.remove"),
											onConfirm: () => remove(url, list),
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
							invalid={invalid}
							className="h-[30px] flex-1 text-detail"
						/>
						<Button variant="subtle" size="sm" disabled={!adding.trim() || invalid} onClick={add} icon={<Plus size={13} strokeWidth={2} aria-hidden />}>
							{t("mcp.add")}
						</Button>
					</div>
					{invalid && <p className="text-caption text-danger">{t("registry.httpsOnly")}</p>}

					{confirm.element}
				</div>
			</DialogFrame>
		)}</Overlay>
	);
}
