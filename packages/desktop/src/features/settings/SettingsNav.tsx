/**
 * Settings chapter list. The active fill is a sliding pill, not a snap of
 * `bg-card-hover` on the row: that snap is what made the switch feel stiff.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import type { SettingsSection } from "../../store/index.ts";
import type { MessageKey } from "../../i18n/index.ts";
import type { LucideIcon } from "lucide-react";

type Group = {
	labelKey: MessageKey;
	items: { id: SettingsSection; labelKey: MessageKey; icon: LucideIcon }[];
};

export function SettingsNav({
	groups,
	section,
	compact,
	label,
	onPick,
}: {
	groups: Group[];
	section: SettingsSection;
	compact: boolean;
	label: (key: MessageKey) => string;
	onPick: (id: SettingsSection) => void;
}) {
	const root = useRef<HTMLDivElement>(null);
	const [pill, setPill] = useState({ y: 0, h: compact ? 40 : 32, ready: false });

	const measure = useCallback(() => {
		const rootEl = root.current;
		if (!rootEl) return;
		const button = rootEl.querySelector<HTMLElement>('[aria-current="page"]');
		if (!button) return;
		const y = button.offsetTop;
		const h = button.offsetHeight;
		setPill((prev) => {
			if (prev.y === y && prev.h === h) return prev;
			return { y, h, ready: prev.ready };
		});
	}, []);

	useLayoutEffect(() => {
		measure();
	}, [measure, section, compact]);

	useEffect(() => {
		const rootEl = root.current;
		if (!rootEl) return;
		const ro = new ResizeObserver(measure);
		ro.observe(rootEl);
		return () => ro.disconnect();
	}, [measure]);

	useEffect(() => {
		setPill((prev) => (prev.ready ? prev : { ...prev, ready: true }));
	}, [pill.y, pill.h]);

	return (
		<Scroller className="flex-1" contentClassName={`pb-3 ${compact ? "px-3" : "px-2.5"}`}>
			<div
				ref={root}
				className="relative"
				style={
					{
						"--ly-nav-pill-y": `${pill.y}px`,
						"--ly-nav-pill-h": `${pill.h}px`,
					} as React.CSSProperties
				}
			>
				<div className="ly-settings-nav-pill" data-ready={pill.ready ? "true" : "false"} />
				{groups.map((group) => (
					<div key={group.labelKey} className="flex flex-col gap-[2px]">
						<div className="px-2 pt-4 pb-1 text-detail text-ink-faint">{label(group.labelKey)}</div>
						{group.items.map((item) => (
							<button
								key={item.id}
								aria-current={section === item.id ? "page" : undefined}
								type="button"
								onClick={() => onPick(item.id)}
								className={`relative z-[1] flex w-full items-center gap-2.5 rounded-lg px-2 text-left text-label transition-colors duration-[var(--ly-t-base)] ease-[var(--ly-e-out)] ${
									compact ? "h-[40px]" : "h-[32px]"
								} ${
									section === item.id
										? "text-ink"
										: "text-ink-muted hover:bg-card-hover/60 hover:text-ink"
								}`}
							>
								<item.icon size={15} strokeWidth={1.8} className="shrink-0" />
								{label(item.labelKey)}
							</button>
						))}
					</div>
				))}
			</div>
		</Scroller>
	);
}
