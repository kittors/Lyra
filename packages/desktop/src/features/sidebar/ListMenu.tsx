/**
 * How the list is ordered, and how much of it is open.
 *
 * A menu rather than more controls in the strip. Sorting and folding are settings you change now
 * and then and read never — a permanent control for each would put three more targets in a column
 * whose whole problem is that conversations start too far down it.
 *
 * Ordering applies to both halves at once, which is the point of it being here rather than on a
 * tab: 「项目」 and 「聊天」 are two arrangements of the same conversations, and a list sorted one
 * way in one of them and another way in the other is two different answers to the same question.
 */

import { CalendarPlus, ChevronsDownUp, ChevronsUpDown, Clock, Check } from "lucide-react";
import { MenuBody, MenuItem, MenuLabel, MenuSeparator, Popover, type Anchor } from "../../ui/overlay/Popover.tsx";
import type { SidebarTab } from "./SidebarTabs.tsx";

/** Which timestamp orders the list, and bands it. */
export type SortKey = "updatedAt" | "createdAt";

const SORTS: { value: SortKey; label: string; icon: React.ReactNode }[] = [
	{ value: "updatedAt", label: "最近更新", icon: <Clock size={14} strokeWidth={1.8} /> },
	{ value: "createdAt", label: "最近创建", icon: <CalendarPlus size={14} strokeWidth={1.8} /> },
];

export function ListMenu({
	anchor,
	tab,
	sort,
	onSort,
	allFolded,
	onFoldAll,
	onClose,
}: {
	anchor: Anchor;
	tab: SidebarTab;
	sort: SortKey;
	onSort: (sort: SortKey) => void;
	/** Whether every project is currently shut, which is what makes this one control and not two. */
	allFolded: boolean;
	onFoldAll: (folded: boolean) => void;
	onClose: () => void;
}) {
	return (
		<Popover anchor={anchor} onClose={onClose} placement="bottom" width="compact" label="列表设置">
			<MenuBody insetIcons>
				<MenuLabel>排序方式</MenuLabel>
				{SORTS.map((option) => (
					<MenuItem
						key={option.value}
						icon={option.icon}
						selected={sort === option.value}
						trailing={sort === option.value ? <Check size={13} strokeWidth={2.2} /> : undefined}
						onClick={() => {
							onSort(option.value);
							onClose();
						}}
					>
						{option.label}
					</MenuItem>
				))}

				{/*
				 * Only under 「项目」, because there is nothing to fold under the other one.
				 *
				 * A row that is present but does nothing is worse than one that is absent: it says
				 * the feature is missing rather than inapplicable, and the only way to find out
				 * which is to press it.
				 */}
				{tab === "projects" && (
					<>
						<MenuSeparator />
						<MenuItem
							icon={
								allFolded ? (
									<ChevronsUpDown size={14} strokeWidth={1.8} />
								) : (
									<ChevronsDownUp size={14} strokeWidth={1.8} />
								)
							}
							onClick={() => {
								onFoldAll(!allFolded);
								onClose();
							}}
						>
							{allFolded ? "展开全部项目" : "收起全部项目"}
						</MenuItem>
					</>
				)}
			</MenuBody>
		</Popover>
	);
}
