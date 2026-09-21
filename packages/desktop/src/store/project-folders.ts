/**
 * The folders the open project is made of, as one answer several panes can share.
 *
 * The file tree, the tree that drops out of the open file's name, and the `@` menu all need the
 * same list, and each of them used to reach for `workspace.path` — which is one folder, the one
 * sessions run in. Working them out separately is how a project ends up listed with two source
 * folders while every pane that browses it shows one.
 *
 * Falls back to the working directory for a project that is not on the list at all (a scratch
 * workspace, a directory opened before it was ever saved), which is exactly what those panes
 * showed before this existed.
 */

import { useMemo } from "react";

import { projectFolders } from "@lyra/core/project-folders";
import { useApp } from "./index.ts";

export function useProjectFolders(): string[] {
	const workspace = useApp((s) => s.workspace);
	const projects = useApp((s) => s.settings?.projects);
	return useMemo(() => {
		if (!workspace) return [];
		const entry = projects?.find((project) => project.path === workspace.path);
		return entry ? projectFolders(entry) : [workspace.path];
	}, [workspace, projects]);
}
