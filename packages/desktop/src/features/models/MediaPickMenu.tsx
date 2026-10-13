/**
 * "Make this again with…": a short list of image and/or video models, opened from a drawing's card.
 *
 * Sections rather than one list, because the same click means two different things — redraw with
 * another image model, or make the picture into a video — and the heading is what says which. The
 * model that made this one is filled, so the list reads as "this, or another".
 */

import { type MediaKind } from "@lyra/core/image-models";
import { ambiguousNames, groupModels } from "../../lib/model-grouping.ts";
import { useApp } from "../../store/index.ts";
import { MenuBody, MenuLabel, MenuSeparator, Popover, type Anchor } from "../../ui/overlay/Popover.tsx";
import { ModelItem } from "./ModelMenu.tsx";

export function MediaPickMenu({
	anchor,
	onClose,
	label,
	made,
	sections,
	onPick,
}: {
	anchor: Anchor;
	onClose: () => void;
	label: string;
	/** The model that made the picture or video this is opened from. */
	made?: string;
	sections: { kind: MediaKind; title: string }[];
	onPick: (kind: MediaKind, modelId: string) => void;
}) {
	const providers = useApp((s) => s.settings?.providers);
	const shown = sections.map((section) => ({ ...section, groups: groupModels(providers, section.kind) })).filter((section) => section.groups.length > 0);
	return (
		<Popover anchor={anchor} onClose={onClose} placement="top" align="end" width="wide" label={label}>
			<MenuBody>
				{shown.map(({ kind, title, groups }, at) => {
					const clashes = ambiguousNames(groups);
					return (
						<div key={kind} data-ly-pick-kind={kind}>
							{at > 0 && <MenuSeparator />}
							<MenuLabel>{title}</MenuLabel>
							<div className="flex flex-col gap-0.5">
								{groups.flatMap((group) =>
									group.models.map((model) => (
										<ModelItem
											key={model.id}
											row={{ provider: group.provider, model }}
											selected={model.id === made}
											showProvider={clashes.has(model.name.trim().toLowerCase())}
											numbered={false}
											shortcut={null}
											onChoose={() => {
												onPick(kind, model.id);
												onClose();
											}}
										/>
									)),
								)}
							</div>
						</div>
					);
				})}
			</MenuBody>
		</Popover>
	);
}
