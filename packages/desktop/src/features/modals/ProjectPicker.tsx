import { Check, Folder, Plus, X } from "lucide-react";
import { useState } from "react";
import { MENU_MAX_HEIGHT, MenuBody, MenuItem, MenuSearch, Popover, type Anchor } from "../../ui/overlay/Popover.tsx";
import { useLayout } from "../../app/layout.tsx";
import { useApp } from "../../store/index.ts";

/**
 * Project switcher, anchored to whatever opened it.
 *
 * It used to be a centred dialog reached from the app title, which made changing project feel
 * like a mode switch for the whole window. Hanging it off the composer's project chip keeps
 * the control next to the thing it scopes — the turn you are about to send.
 */
export function ProjectPicker({ anchor, onClose }: { anchor: Anchor; onClose: () => void }) {
	const settings = useApp((s) => s.settings);
	const workspace = useApp((s) => s.workspace);
	const openWorkspace = useApp((s) => s.openWorkspace);
	const pickWorkspace = useApp((s) => s.pickWorkspace);
	const clearWorkspace = useApp((s) => s.clearWorkspace);
	// Switching projects changes what is behind the drawer, so the drawer has to go with it.
	const { dismissNav } = useLayout();
	const [query, setQuery] = useState("");

	const projects = (settings?.projects ?? [])
		.filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase()) || p.path.includes(query))
		.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);

	const choose = (action: () => void) => {
		action();
		onClose();
		dismissNav();
	};

	return (
		<Popover
			anchor={anchor}
			onClose={onClose}
			placement="top"
			align="start"
			width="wide"
			maxHeight={MENU_MAX_HEIGHT}
			label="切换项目"
			header={<MenuSearch value={query} onChange={setQuery} placeholder="搜索项目" />}
			// The two ways out of the list stay put while it scrolls: neither is about a project
			// you are looking at, and both are what you reach for when none of them is the one.
			footer={
				<MenuBody>
					<MenuItem icon={<Plus size={13} strokeWidth={1.9} />} onClick={() => choose(() => void pickWorkspace())}>
						新建项目
					</MenuItem>
					<MenuItem icon={<X size={13} strokeWidth={1.9} />} onClick={() => choose(clearWorkspace)}>
						不在项目中工作
					</MenuItem>
				</MenuBody>
			}
		>
			<MenuBody>
				{projects.map((project) => (
					<MenuItem
						key={project.path}
						icon={<Folder size={13} strokeWidth={1.8} />}
						title={project.path}
						selected={workspace?.path === project.path}
						trailing={
							workspace?.path === project.path ? (
								<Check size={13} strokeWidth={2.2} className="shrink-0 text-ink" />
							) : undefined
						}
						onClick={() => choose(() => void openWorkspace(project.path))}
					>
						{project.name}
					</MenuItem>
				))}

				{projects.length === 0 && <p className="px-2.5 py-5 text-center text-detail text-ink-faint">还没有项目</p>}
			</MenuBody>
		</Popover>
	);
}
