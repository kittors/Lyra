import { translate } from "../../../i18n/translate.ts";
import { ChevronsDownUp, ChevronsUpDown, Download, FileText, MoreHorizontal, RefreshCw } from "lucide-react";
import { useState } from "react";
import { IconButton } from "../../../ui/primitives/IconButton.tsx";
import { MenuBody, MenuItem } from "../../../ui/overlay/Menu.tsx";
import { Popover } from "../../../ui/overlay/Popover.tsx";

export function TraceActions({ collapsed, refreshing, onCollapse, onRefresh, onExport }: {
	collapsed: boolean;
	refreshing: boolean;
	onCollapse: () => void;
	onRefresh: () => void;
	onExport?: (format: "json" | "md") => void;
}) {
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	const run = (action: () => void) => { setAnchor(null); action(); };
	return <>
		<IconButton label={translate("traceActions.menu")} icon={refreshing ? <RefreshCw size={14} className="animate-spin" /> : <MoreHorizontal size={16} />} onClick={event => setAnchor(anchor ? null : event.currentTarget)} />
		{anchor && <Popover anchor={anchor} onClose={() => setAnchor(null)} align="end" label={translate("traceActions.menu")} width="default"><MenuBody>
			<MenuItem icon={<RefreshCw size={14} />} onClick={() => run(onRefresh)}>{translate("traceActions.reload")}</MenuItem>
			<MenuItem icon={collapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />} onClick={() => run(onCollapse)}>{translate(collapsed ? "traceActions.expandAll" : "traceActions.collapseAll")}</MenuItem>
			{onExport && <>
				<MenuItem icon={<Download size={14} />} onClick={() => run(() => onExport("json"))}>{translate("traceActions.exportJson")}</MenuItem>
				<MenuItem icon={<FileText size={14} />} onClick={() => run(() => onExport("md"))}>{translate("traceActions.viewMarkdown")}</MenuItem>
			</>}
		</MenuBody></Popover>}
	</>;
}
