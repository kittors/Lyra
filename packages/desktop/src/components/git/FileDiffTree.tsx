import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { useMemo, useState } from "react";
import type { WorkspaceDiffFile } from "../../../electron/ipc-types.ts";
import { BinaryDiff } from "./BinaryDiff.tsx";
import { DiffView } from "../DiffView.tsx";
import { iconColour, lookFor } from "../fileIcon.tsx";
import { Text } from "../../ui/primitives/Text.tsx";

interface TreeNode {
	name: string;
	path: string;
	isFile: boolean;
	file?: WorkspaceDiffFile;
	children: Record<string, TreeNode>;
}

function buildTree(files: WorkspaceDiffFile[]): TreeNode {
	const root: TreeNode = {
		name: "",
		path: "",
		isFile: false,
		children: {},
	};

	for (const file of files) {
		const segments = file.path.split("/").filter(Boolean);
		let current = root;
		let currentPath = "";

		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i];
			currentPath = currentPath ? `${currentPath}/${seg}` : seg;
			const isLast = i === segments.length - 1;

			if (isLast) {
				current.children[seg] = {
					name: seg,
					path: file.path,
					isFile: true,
					file,
					children: {},
				};
			} else {
				if (!current.children[seg]) {
					current.children[seg] = {
						name: seg,
						path: currentPath,
						isFile: false,
						children: {},
					};
				}
				current = current.children[seg];
			}
		}
	}

	return root;
}

export function FileDiffTree({
	files,
	cwd = null,
	actions,
}: {
	files: WorkspaceDiffFile[];
	cwd?: string | null;
	actions?: (file: WorkspaceDiffFile) => React.ReactNode;
}) {
	const tree = useMemo(() => buildTree(files), [files]);
	const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
		// Default: expand all folder levels for convenience
		const set = new Set<string>();
		function collect(node: TreeNode) {
			if (!node.isFile && node.path) set.add(node.path);
			for (const child of Object.values(node.children)) collect(child);
		}
		collect(tree);
		return set;
	});

	const [openFiles, setOpenFiles] = useState<Set<string>>(new Set());

	const toggleFolder = (path: string) => {
		setExpandedFolders((current) => {
			const next = new Set(current);
			if (!next.delete(path)) next.add(path);
			return next;
		});
	};

	const toggleFile = (path: string) => {
		setOpenFiles((current) => {
			const next = new Set(current);
			if (!next.delete(path)) next.add(path);
			return next;
		});
	};

	function renderNode(node: TreeNode, depth = 0): React.ReactNode {
		if (!node.isFile) {
			const isExpanded = expandedFolders.has(node.path);
			const childNodes = Object.values(node.children).sort((a, b) => {
				// Directories first, then files
				if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
				return a.name.localeCompare(b.name);
			});

			return (
				<div key={node.path || "root"}>
					{node.path && (
						<button
							type="button"
							onClick={() => toggleFolder(node.path)}
							style={{ paddingLeft: `${Math.max(4, depth * 14)}px` }}
							className="flex w-full items-center gap-1.5 rounded-md py-1 pr-1 text-left text-detail text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
						>
							{isExpanded ? (
								<ChevronDown size={11} strokeWidth={2} className="shrink-0 text-ink-faint" />
							) : (
								<ChevronRight size={11} strokeWidth={2} className="shrink-0 text-ink-faint" />
							)}
							{isExpanded ? (
								<FolderOpen size={13} strokeWidth={1.8} className="shrink-0 text-accent/80" />
							) : (
								<Folder size={13} strokeWidth={1.8} className="shrink-0 text-ink-faint" />
							)}
							<span className="truncate font-medium">{node.name}</span>
						</button>
					)}
					{(isExpanded || !node.path) && (
						<div>{childNodes.map((child) => renderNode(child, node.path ? depth + 1 : depth))}</div>
					)}
				</div>
			);
		}

		const file = node.file!;
		const isExpanded = openFiles.has(file.path);
		const look = lookFor(node.name, false);

		return (
			<div key={file.path} className="group/tree-file mb-0.5">
				<div
					style={{ paddingLeft: `${Math.max(4, depth * 14)}px` }}
					className="flex items-center gap-1 rounded-md pr-1 transition-colors hover:bg-card-hover"
				>
					<button
						type="button"
						onClick={() => toggleFile(file.path)}
						className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
					>
						<ChevronRight
							size={11}
							strokeWidth={2.2}
							className="shrink-0 text-ink-faint transition-transform duration-[var(--ly-t-quick)]"
							style={isExpanded ? { transform: "rotate(90deg)" } : undefined}
						/>
						<look.Icon size={12.5} strokeWidth={1.75} className="shrink-0" style={{ color: iconColour(look) }} />
						<span className="min-w-0 flex-1 truncate text-left text-detail text-ink">{node.name}</span>
						<Text size="caption" mono numeric className="shrink-0">
							{file.added > 0 && <span className="text-ok">+{file.added}</span>}
							{file.added > 0 && file.removed > 0 && " "}
							{file.removed > 0 && <span className="text-danger">−{file.removed}</span>}
						</Text>
					</button>
					{actions?.(file)}
				</div>

				{isExpanded && (
					<div className="ly-enter mt-0.5 mb-1.5 border-y border-line-soft">
						{file.binary ? (
							<BinaryDiff cwd={cwd} file={file} />
						) : file.hunks.length === 0 ? (
							<Text as="p" size="detail" tone="faint" className="px-3 py-4 text-center">
								这个文件没有可以按行对比的内容。
							</Text>
						) : (
							<DiffView hunks={file.hunks} path={file.path} />
						)}
					</div>
				)}
			</div>
		);
	}

	return <div className="py-0.5">{Object.values(tree.children).map((child) => renderNode(child, 0))}</div>;
}