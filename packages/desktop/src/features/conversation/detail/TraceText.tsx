import { translate } from "../../../i18n/translate.ts";
import { Check, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Markdown } from "../Markdown.tsx";
import { CodeText } from "./CodeText.tsx";
import { Section } from "./Section.tsx";
import { IconButton } from "../../../ui/primitives/IconButton.tsx";

const PAGE = 4000;

/** The source remains complete and copyable while every rendered text page stays bounded. */
export function TraceText({ title, text, kind = "text", query = "", markdown = false }: { title: string; text: string; kind?: "text" | "json" | "shell"; query?: string; markdown?: boolean }) {
	const [page, setPage] = useState(0);
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState("");
	const pages = Math.max(1, Math.ceil(text.length / PAGE));
	useEffect(() => {
		const match = query.trim() ? text.toLowerCase().indexOf(query.trim().toLowerCase()) : 0;
		setPage(Math.floor(Math.max(0, match) / PAGE)); setCopied(false);
	}, [text, query]);
	const current = Math.min(page, pages - 1);
	return <Section title={title} mono>
		<div className="mb-1 flex h-[22px] items-center justify-end gap-1 font-sans text-caption text-ink-faint">
			<span className="mr-auto tabular-nums">{translate("traceText.charCount", { count: text.length.toLocaleString() })}{pages > 1 ? ` · ${current + 1}/${pages}` : ""}</span>
			{pages > 1 && <><IconButton size="sm" label={translate("traceText.prevPage", { title })} icon={<ChevronLeft size={12} />} disabled={current === 0} onClick={() => setPage(current - 1)} /><IconButton size="sm" label={translate("traceText.nextPage", { title })} icon={<ChevronRight size={12} />} disabled={current === pages - 1} onClick={() => setPage(current + 1)} /></>}
			<IconButton size="sm" label={translate("traceText.copyAll", { title })} icon={copied ? <Check size={12} /> : <Copy size={12} />} onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setError(""); }).catch((error: unknown) => setError(String(error))); }} />
		</div>
		{markdown && !query && pages === 1 ? <div className="font-sans"><Markdown text={text} /></div> : <CodeText text={text.slice(current * PAGE, (current + 1) * PAGE)} kind={kind} query={query} />}
		{error && <span role="alert" className="text-danger">{error}</span>}
	</Section>;
}
