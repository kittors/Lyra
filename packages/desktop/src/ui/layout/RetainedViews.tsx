import { Activity, useState } from "react";

/** Retain a small number of visited pages; hidden pages suspend effects and keep local state. */
export function RetainedViews<T extends string>({
	active,
	render,
	limit = 3,
	pageClassName = "ly-page-enter",
}: {
	active: T;
	render: (key: T) => React.ReactNode;
	limit?: number;
	/** Arrival class. Settings uses a longer fade-and-rise than the workspace pages. */
	pageClassName?: string;
}) {
	const [recent, setRecent] = useState<T[]>([active]);
	let keys = recent;
	if (recent[recent.length - 1] !== active) {
		keys = [...recent.filter((key) => key !== active), active].slice(-limit);
		setRecent(keys);
	}
	const shown = [active, ...keys.filter((key) => key !== active)];
	return <>{shown.map((key) => (
		<Activity key={key} mode={key === active ? "visible" : "hidden"}>
			<div
				className={`${pageClassName} flex min-h-0 min-w-0 flex-1 flex-col`}
				data-view={key}
				data-active={key === active ? "true" : "false"}
			>
				{render(key)}
			</div>
		</Activity>
	))}</>;
}
