/**
 * A spreadsheet or a database, drawn as the grid it is.
 *
 * One component for both because once the rows have been read they are the same thing: named
 * sheets of cells with a header row. What differs is the word on the tab — a workbook has sheets,
 * a database has tables — and that is a label, not a layout.
 *
 * Deliberately shaped like Excel rather than like an HTML table: a frozen header, a row-number
 * gutter, right-aligned numbers, and cells that clip instead of wrapping. Those are not decoration.
 * A spreadsheet is read by scanning columns, and a table whose rows change height as text wraps
 * cannot be scanned at all.
 */

import { useEffect, useMemo, useState } from "react";
import { Database, Table2 } from "lucide-react";
import type { DocumentData } from "../../../electron/ipc-types.ts";
import { Scroller } from "../Scroller.tsx";
import { Text } from "../Text.tsx";
import { bridge } from "../../services/index.ts";

/** Numbers line up on the right; everything else reads from the left. */
const NUMERIC = /^-?[\d,]+(\.\d+)?%?$/;

export function SheetView({ path }: { path: string }) {
	const [data, setData] = useState<DocumentData | null>(null);
	const [active, setActive] = useState(0);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let live = true;
		setData(null);
		setFailed(false);
		setActive(0);
		void bridge.files
			.document(path)
			.then((result) => {
				if (!live) return;
				if (result) setData(result);
				else setFailed(true);
			})
			.catch(() => live && setFailed(true));
		return () => {
			live = false;
		};
	}, [path]);

	const sheet = data?.sheets[active];
	const alignment = useMemo(
		() =>
			sheet
				? sheet.columns.map((_, column) => {
						// Judged from the body, not the header: a column called `2024` is still text.
						const sample = sheet.rows.slice(0, 30).map((row) => row[column]).filter(Boolean);
						return sample.length > 0 && sample.every((value) => NUMERIC.test(value)) ? "right" : "left";
					})
				: [],
		[sheet],
	);

	if (failed || data?.error) {
		return (
			<Centred>
				<Text size="label" tone="muted">
					{data?.error ?? "读不到这个文件。"}
				</Text>
			</Centred>
		);
	}
	if (!data) return <div className="flex-1" aria-hidden />;
	if (data.sheets.length === 0) {
		return (
			<Centred>
				<Text size="label" tone="muted">
					{data.kind === "tables" ? "这个数据库里没有表。" : "这个工作簿里没有工作表。"}
				</Text>
			</Centred>
		);
	}

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<Scroller className="min-h-0 flex-1">
				<table className="ly-sheet w-max border-collapse text-detail">
					<thead>
						<tr>
							{/* The gutter's own corner, which has to sit above and left of everything. */}
							<th className="ly-sheet-corner" />
							{sheet?.columns.map((column, index) => (
								<th key={`${column}-${index}`} className="ly-sheet-head">
									{column}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{sheet?.rows.map((row, rowIndex) => (
							// eslint-disable-next-line react/no-array-index-key
							<tr key={rowIndex}>
								<td className="ly-sheet-gutter">{rowIndex + 1}</td>
								{row.map((value, column) => (
									<td
										// eslint-disable-next-line react/no-array-index-key
										key={column}
										className="ly-sheet-cell"
										style={{ textAlign: alignment[column] }}
										// The app's own tooltip, not the native one — see `test/native-title.test.ts`.
										data-ly-tip={value.length > 32 ? value : undefined}
									>
										{value}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</Scroller>

			{/*
			 * The tab strip at the bottom, where both Excel and every database browser put it.
			 *
			 * Always rendered, even for one sheet: it is also where the row count lives, and "how
			 * much of this am I looking at" is the question a truncated table has to answer.
			 */}
			<div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-line px-2 py-1.5">
				{data.sheets.map((entry, index) => (
					<button
						key={entry.name}
						type="button"
						onClick={() => setActive(index)}
						className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-caption transition-colors ${
							index === active ? "bg-card-hover text-ink" : "text-ink-muted hover:bg-card-hover hover:text-ink"
						}`}
					>
						{data.kind === "tables" ? <Database size={11} strokeWidth={1.9} /> : <Table2 size={11} strokeWidth={1.9} />}
						<span className="max-w-[160px] truncate">{entry.name}</span>
					</button>
				))}
				<span className="ml-auto shrink-0 pr-1">
					<Text size="caption" tone="faint" numeric>
						{sheet
							? sheet.total > sheet.rows.length
								? `${sheet.rows.length} / ${sheet.total} 行`
								: `${sheet.total} 行`
							: ""}
					</Text>
				</span>
			</div>
		</div>
	);
}

function Centred({ children }: { children: React.ReactNode }) {
	return <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">{children}</div>;
}
