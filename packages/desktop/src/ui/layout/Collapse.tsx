import { useLayoutEffect, useState, type ReactNode } from "react";
import { motionReduced } from "../motion/reduced.ts";

/** Keep the closing content alive until its size transition finishes, then release costly trees. */
export function Collapse({ open, children, bodyClassName, className = "", keepMounted = false }: {
	open: boolean;
	children: ReactNode;
	bodyClassName?: string;
	className?: string;
	keepMounted?: boolean;
}) {
	const [retained, setRetained] = useState(open);
	useLayoutEffect(() => {
		if (open) setRetained(true);
		else if (!keepMounted && motionReduced()) setRetained(false);
	}, [open, keepMounted]);
	const settled = () => { if (!open && !keepMounted) setRetained(false); };
	return <div className={`ly-reveal ly-freeze ${className}`.trim()} data-open={open} inert={!open} aria-hidden={!open}
		onTransitionEnd={event => { if (event.target === event.currentTarget && event.propertyName === "grid-template-rows") settled(); }}>
		<div><div className={bodyClassName}>{(open || retained) && children}</div></div>
	</div>;
}
