/**
 * Which archived project groups are open.
 *
 * Closed is the default: a page of twenty projects should not dump every transcript at once.
 * Search is the exception — a match you cannot see is not a match — so a query forces those
 * groups open without writing them into the set the person has been clicking.
 */

export function groupIsOpen(path: string, opened: ReadonlySet<string>, searching: boolean): boolean {
	return searching || opened.has(path);
}

export function toggleOpened(opened: ReadonlySet<string>, path: string): Set<string> {
	const next = new Set(opened);
	if (next.has(path)) next.delete(path);
	else next.add(path);
	return next;
}
