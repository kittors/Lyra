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

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { Overlay } from "../modals/Overlay.tsx";
import { GhostButton } from "../settings/controls.tsx";
import { TextInput } from "../settings/inputs.tsx";
import { useApp } from "../../store.ts";

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
		<Overlay onClose={onClose} width={520}>
			<div className="px-5 py-4">
				<h2 className="text-body font-medium text-ink">插件市场</h2>
				<p className="mt-1 text-detail leading-relaxed text-ink-muted">
					一个市场就是一个 https 地址，指向一份列出插件的 JSON。加进来之后，它列的插件会出现在插件页里。
				</p>

				<div className="mt-4 flex flex-col gap-1.5">
					{sources.map((url) => {
						const failed = errors.find((e) => e.url === url);
						return (
							<div key={url} className="flex items-center gap-2 text-detail">
								<span className={`min-w-0 flex-1 truncate font-mono ${failed ? "text-danger" : "text-ink-faint"}`}>
									{url}
								</span>
								{failed && <span className="shrink-0 text-danger">{failed.message}</span>}
								<button
									type="button"
									data-ly-tip="移除这个市场"
									aria-label={`移除 ${url}`}
									onClick={() =>
										confirm.ask({
											title: "移除这个插件市场？",
											detail: "从它装过的插件都留在本地，只是以后不会再从这里看到新的。",
											confirmLabel: "移除",
											onConfirm: () => remove(url),
										})
									}
									className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-danger/10 hover:text-danger"
								>
									<Trash2 size={12} strokeWidth={1.8} />
								</button>
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
						<GhostButton onClick={add} icon={<Plus size={12} strokeWidth={2} />}>
							添加
						</GhostButton>
					</div>

					{confirm.element}
				</div>
			</div>
		</Overlay>
	);
}
