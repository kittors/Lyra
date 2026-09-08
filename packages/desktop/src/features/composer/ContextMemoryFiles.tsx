import { translate } from "../../i18n/translate.ts";
import { FileText } from "lucide-react";
import { useState } from "react";
import type { ContextBreakdown } from "../../../electron/ipc-types.ts";
import { useOpenFile } from "../../store/openFile.ts";
import { Disclosure } from "../../ui/layout/Disclosure.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { formatTokens } from "../conversation/index.ts";
import { companionOf, useDock } from "../dock/index.ts";

/** The paths come from the prompt sources, never guessed from the renderer's workspace. */
export function ContextMemoryFiles({ detail, onOpen }: { detail: ContextBreakdown; onOpen: () => void }) {
	const [open, setOpen] = useState(false);
	const files = [...(detail.memoryFiles ?? []), ...(detail.projectMemoryFiles ?? [])];
	const tokens = detail.segments.filter((segment) => segment.key === "memory" || segment.key === "projectMemory")
		.reduce((total, segment) => total + segment.tokens, 0);
	return (
		<Disclosure variant="compact" title={translate("memoryFiles.title")} open={open} onToggle={() => setOpen(!open)} trailing={
			<span className="flex gap-2 text-detail tabular-nums text-ink-faint">
				<span>{formatTokens(tokens)}</span><span className="w-[44px] text-right">{files.length}</span>
			</span>
		}>
			{files.map((file) => (
				<button key={file.path} type="button" data-ly-tip={file.path} className="group/file ly-scroll flex w-full items-center gap-1.5 rounded py-1 text-detail text-ink-faint transition-colors hover:text-ink"
					onClick={() => {
						onOpen();
						void useOpenFile.getState().open({ path: file.path, name: file.path.split(/[\\/]/).pop() || file.path, isDirectory: false, size: 0 });
						useDock.getState().open("file", companionOf("file"));
					}}>
					<FileText size={12} strokeWidth={1.8} className="shrink-0" />
					<ScrollText text={file.path} className="min-w-0 flex-1 text-left font-mono text-caption" />
					<span className="shrink-0 tabular-nums">{formatTokens(file.tokens)}</span>
				</button>
			))}
			{!files.length && <p className="py-1 text-detail text-ink-faint">{translate("memoryFiles.none")}</p>}
		</Disclosure>
	);
}
