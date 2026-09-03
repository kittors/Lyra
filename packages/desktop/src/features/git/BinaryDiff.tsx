/**
 * A changed file that has no lines: the picture, or a mark and a size.
 *
 * What this replaces is one sentence — 「这个文件没有可以按行对比的内容（二进制或过大）」 — which is
 * true and tells you nothing you could not read off the file name. The overwhelmingly common
 * binary in a repository is an image, and for an image the diff everyone actually wants is the two
 * pictures side by side.
 *
 * Everything else keeps the sentence, dressed as the file's own mark and its size. A `.zip` cannot
 * be previewed and pretending otherwise would be worse than saying so.
 */

import { useEffect, useMemo, useState } from "react";
import type { WorkspaceDiffFile } from "../../../electron/ipc-types.ts";
import { iconColour, lookFor } from "../files/fileIcon.tsx";
import { Text } from "../../ui/primitives/Text.tsx";
import { bridge } from "../../services/index.ts";

/** Which sides exist for a given change, in reading order. */
function sidesFor(status: WorkspaceDiffFile["status"]): ("head" | "work")[] {
	if (status === "added" || status === "untracked") return ["work"];
	if (status === "deleted") return ["head"];
	return ["head", "work"];
}

const SIDE_LABEL: Record<"head" | "work", string> = { head: "改动前", work: "改动后" };

export function BinaryDiff({ cwd, file }: { cwd: string | null; file: WorkspaceDiffFile }) {
	// Memoised so the effect below depends on a value that only changes when the status does.
	const sides = useMemo(() => sidesFor(file.status), [file.status]);
	const [blobs, setBlobs] = useState<Partial<Record<"head" | "work", string | null>>>({});
	const [settled, setSettled] = useState(false);

	useEffect(() => {
		if (!cwd) {
			setSettled(true);
			return;
		}
		let live = true;
		setSettled(false);
		void Promise.all(
			sides.map(async (side) => [side, (await bridge.diff.blob(cwd, file.path, side))?.dataUrl ?? null] as const),
		).then((pairs) => {
			if (!live) return;
			setBlobs(Object.fromEntries(pairs));
			setSettled(true);
		});
		return () => {
			live = false;
		};
	}, [cwd, file.path, sides]);

	const drawn = sides.filter((side) => blobs[side]);

	// Nothing to draw: the file's own mark, which at least says what kind of thing changed.
	if (settled && drawn.length === 0) return <Mark file={file} />;
	if (!settled) return <div className="h-[120px]" aria-hidden />;

	return (
		<div className="flex flex-wrap items-start justify-center gap-4 px-3 py-4">
			{drawn.map((side) => (
				<figure key={side} className="flex min-w-0 flex-col items-center gap-1.5">
					{/*
					 * Checkered, because a transparent PNG on a dark panel is half invisible — and
					 * whether the background is transparent is frequently the thing being reviewed.
					 */}
					<div className="ly-checker rounded-lg border border-line p-2">
						<img
							src={blobs[side] ?? ""}
							alt={`${file.path} ${SIDE_LABEL[side]}`}
							className="max-h-[220px] max-w-[260px] object-contain"
						/>
					</div>
					{/* Only worth labelling when there are two of them to tell apart. */}
					{drawn.length > 1 && (
						<Text size="caption" tone="faint">
							{SIDE_LABEL[side]}
						</Text>
					)}
				</figure>
			))}
		</div>
	);
}

/** The file's own mark and its size, for everything that is not a picture. */
function Mark({ file }: { file: WorkspaceDiffFile }) {
	const name = file.path.slice(file.path.lastIndexOf("/") + 1);
	const look = lookFor(name, false);

	return (
		<div className="flex flex-col items-center gap-2 px-3 py-6">
			<look.Icon size={26} strokeWidth={1.6} style={{ color: iconColour(look) }} />
			<Text size="detail" tone="muted" className="max-w-full truncate">
				{name}
			</Text>
			<Text size="caption" tone="faint">
				{file.bytes ? `二进制文件 · ${formatBytes(file.bytes)}` : "二进制文件"}
			</Text>
		</div>
	);
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
