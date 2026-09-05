/**
 * A sub-agent's structured reply, drawn by its shape rather than printed as JSON (16 §6.1).
 *
 * An agent that declared an output schema yields an object, and the object is the point: the
 * parent reads `agent://<id>/passed` without re-reading prose. Shown as JSON it is worse than the
 * prose it replaced — braces and quotes are not a reading format. So each value is drawn by what
 * it is: a table for a list of records, a list for a list of words, a badge for a yes or no, a
 * fold for a long text — and `findings` grouped by severity, because that is the one list whose
 * order is not the order it should be read in.
 *
 * Nothing here knows the schema. It reads the value. A schema is what the parent agreed with the
 * sub-agent; the person looking at the pane did not sign it and should not have to.
 */

import { ChevronDown } from "lucide-react";
import { useState } from "react";

type Plain = Record<string, unknown>;

const SHORT_TEXT = 160;
/** `findings` and friends: group by this key when every row has it. */
const SEVERITY_ORDER = ["critical", "high", "error", "medium", "warning", "low", "info", "note"];

function isPlain(value: unknown): value is Plain {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordList(value: unknown): value is Plain[] {
	return Array.isArray(value) && value.length > 0 && value.every(isPlain);
}

/** A path-shaped string is drawn in mono; the rest as prose. */
function looksLikePath(key: string, value: unknown): boolean {
	return typeof value === "string" && (/^(path|file|files?|location|command|dir)$/i.test(key) || /^[\w./-]+\.[a-z]{1,5}(:\d+)?$/i.test(value));
}

export function StructuredOutput({ output }: { output: Plain }) {
	return (
		<div className="min-w-0 space-y-2" data-structured-output>
			{Object.entries(output).map(([key, value]) => (
				<Field key={key} name={key} value={value} />
			))}
		</div>
	);
}

function Field({ name, value }: { name: string; value: unknown }) {
	if (value === null || value === undefined) return null;
	if (typeof value === "boolean") {
		return (
			<div className="flex items-center gap-2 text-detail" data-field={name} data-kind="flag">
				<Key name={name} />
				<span className={`rounded px-1.5 text-caption ${value ? "bg-ok/15 text-ok" : "bg-danger/15 text-danger"}`}>{value ? "是" : "否"}</span>
			</div>
		);
	}
	if (typeof value === "number") {
		return (
			<div className="flex items-center gap-2 text-detail" data-field={name} data-kind="number">
				<Key name={name} />
				<span className="tabular-nums text-ink">{value}</span>
			</div>
		);
	}
	if (typeof value === "string") {
		const long = value.length > SHORT_TEXT || value.includes("\n");
		if (long) return <LongText name={name} text={value} />;
		return (
			<div className="flex items-baseline gap-2 text-detail" data-field={name} data-kind="text">
				<Key name={name} />
				<span className={`min-w-0 break-words text-ink ${looksLikePath(name, value) ? "font-mono text-label" : ""}`}>{value}</span>
			</div>
		);
	}
	if (isRecordList(value)) return <Records name={name} rows={value} />;
	if (Array.isArray(value)) {
		if (value.length === 0) {
			return (
				<div className="flex items-center gap-2 text-detail" data-field={name} data-kind="empty">
					<Key name={name} />
					<span className="text-ink-faint">无</span>
				</div>
			);
		}
		return (
			<div data-field={name} data-kind="list">
				<Key name={name} />
				<ul className="mt-0.5 ml-4 list-disc space-y-0.5 text-detail text-ink">
					{value.map((item, i) => (
						// Items are read-only and positional; the index is what identifies them.
						<li key={i} className={looksLikePath(name, item) ? "font-mono text-label" : ""}>
							{isPlain(item) ? <StructuredOutput output={item} /> : String(item)}
						</li>
					))}
				</ul>
			</div>
		);
	}
	if (isPlain(value)) {
		return (
			<div data-field={name} data-kind="object">
				<Key name={name} />
				<div className="ml-3 mt-0.5 border-l border-line-soft pl-2">
					<StructuredOutput output={value} />
				</div>
			</div>
		);
	}
	return null;
}

function Key({ name }: { name: string }) {
	return <span className="shrink-0 font-mono text-caption text-ink-faint">{name}</span>;
}

function LongText({ name, text }: { name: string; text: string }) {
	const [open, setOpen] = useState(false);
	return (
		<div data-field={name} data-kind="long-text">
			<button
				type="button"
				onClick={() => setOpen((was) => !was)}
				aria-expanded={open}
				className="flex items-center gap-1 text-detail text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:text-ink"
			>
				<ChevronDown size={12} strokeWidth={2} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
				<Key name={name} />
				{!open && <span className="truncate text-ink-faint">{text.slice(0, 80)}…</span>}
			</button>
			{open && <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-detail leading-relaxed text-ink">{text}</pre>}
		</div>
	);
}

/**
 * A list of records is a table; `findings` with a severity on every row is several, in order of
 * how much each deserves to be read first.
 */
function Records({ name, rows }: { name: string; rows: Plain[] }) {
	const bySeverity = rows.every((row) => typeof row.severity === "string");
	if (!bySeverity) return <Table name={name} rows={rows} />;
	const groups = new Map<string, Plain[]>();
	for (const row of rows) {
		const severity = String(row.severity);
		groups.set(severity, [...(groups.get(severity) ?? []), row]);
	}
	const ordered = [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b));
	return (
		<div data-field={name} data-kind="grouped">
			<Key name={name} />
			{ordered.map(([severity, group]) => (
				<div key={severity} className="mt-1" data-severity={severity}>
					<div className="text-caption text-ink-muted">
						{severity} · {group.length}
					</div>
					<Table rows={group.map(({ severity: _severity, ...rest }) => rest)} />
				</div>
			))}
		</div>
	);
}

function rank(severity: string): number {
	const at = SEVERITY_ORDER.indexOf(severity.toLowerCase());
	return at === -1 ? SEVERITY_ORDER.length : at;
}

function Table({ name, rows }: { name?: string; rows: Plain[] }) {
	const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
	return (
		<div data-field={name} data-kind="table" className="min-w-0 overflow-x-auto">
			{name && <Key name={name} />}
			<table className="mt-0.5 w-full text-detail">
				<thead>
					<tr>
						{columns.map((column) => (
							<th key={column} className="py-0.5 pr-3 text-left font-mono text-caption font-normal text-ink-faint">
								{column}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, i) => (
						// Rows are positional.
						<tr key={i} className="align-top text-ink">
							{columns.map((column) => (
								<td key={column} className={`py-0.5 pr-3 ${looksLikePath(column, row[column]) ? "font-mono text-label" : ""}`}>
									<Cell value={row[column]} />
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function Cell({ value }: { value: unknown }) {
	if (value === null || value === undefined) return <span className="text-ink-faint">—</span>;
	if (typeof value === "boolean") return <span>{value ? "是" : "否"}</span>;
	if (Array.isArray(value)) return <span>{value.map((item) => (isPlain(item) ? JSON.stringify(item) : String(item))).join("、")}</span>;
	if (isPlain(value)) return <StructuredOutput output={value} />;
	return <span className="break-words">{String(value)}</span>;
}
