/**
 * Everything a card says about a bundle other than its name and what it does.
 *
 * Two lines with different jobs. The one under the title is *identity* — which shelf it came from,
 * which version, what it is called on disk, who wrote it — and it is the line you read when you
 * are deciding whether this is the thing you were looking for. The one at the bottom is *size and
 * reach*: how many skills, how many servers, how many people have it, which agents it installs
 * into. That one you read when comparing two entries that both look right.
 *
 * Every field is optional and an absent one is left out rather than dashed. A bundle sitting in
 * `~/.lyra/plugins` has no author, no version beyond what its own manifest claims and no download
 * count, and printing "—" three times to say so fills the line with nothing.
 *
 * None of this is new information. The platform has published all of it since it existed and the
 * site has drawn it on its own cards the whole time; the desktop card showed a name and a sentence,
 * so two views of one catalogue disagreed about how much was known.
 */

/*
 * The labels come from the contract package, not from a copy kept here.
 *
 * `@lyra/registry-shared` is types and pure functions by construction — no filesystem, no network,
 * no DOM — which is what makes it importable from a renderer where `@lyra/core`'s index is not. A
 * second table of these names would be a second thing to update when a client is added, and the
 * one that drifts is always the copy nobody compiles against the platform.
 */
import { CLIENT_LABEL } from "@lyra/registry-shared";

import type { CatalogItem } from "./catalog.ts";

/**
 * The identity line: 公开 · v0.3.7 · agent-browser-cli · sleepinginsummer
 *
 * The id is in the monospace face because it is a string you type — it is the directory the bundle
 * installs as and the argument every command takes — while the name beside it is prose.
 */
export function IdentityLine({ item }: { item: CatalogItem }): React.ReactNode {
	const parts: React.ReactNode[] = [];

	// Which half of the catalogue it belongs to. The card can be reached from either scope, and the
	// distinction survives being installed: something from a registry stays "公开" once you have it.
	parts.push(<span key="scope">{item.entry ? "公开" : "个人"}</span>);
	if (item.version) {
		parts.push(
			<span key="version" className="tabular-nums">
				{/* Prefixed here rather than stored with the `v`, because the version is compared as a
				    string elsewhere and a display prefix in the data is a bug waiting for that. */}
				v{item.version}
			</span>,
		);
	}
	/*
	 * The id resists shrinking four times harder than the author does.
	 *
	 * When the line runs out of room both would otherwise truncate together, each losing half of
	 * what is missing — measured on a 360px card: `agent-browser-cli` and `sleepinginsummer` both
	 * ellipsised, and neither was readable. They are not worth the same. The id is a string you
	 * type: it is the directory on disk and the argument every command takes, so half of it is
	 * useless. An author's name half-shown is still recognisable, and is not something you retype.
	 */
	parts.push(
		<span key="id" className="shrink-[0.25] truncate font-mono">
			{item.id}
		</span>,
	);
	if (item.author) {
		parts.push(
			<span key="author" className="truncate">
				{item.author}
			</span>,
		);
	}

	return (
		<div className="mt-1 flex min-w-0 items-center gap-1.5 text-caption text-ink-faint">
			{parts.map((part, index) => (
				// The separator belongs to the gap between two parts, so the line never ends on one.
				<span key={index} className="flex min-w-0 items-center gap-1.5">
					{index > 0 && <span className="text-ink-faint/50">·</span>}
					{part}
				</span>
			))}
		</div>
	);
}

/**
 * The footprint line: how much it brings, who can use it, how many took it.
 *
 * Skipped entirely when there is nothing to say, rather than rendered as an empty row — a card in a
 * grid whose neighbours have this line is already taller than one that does not, and an empty
 * element makes the difference into a ragged gap instead of an honest one.
 */
export function FootprintLine({ item }: { item: CatalogItem }): React.ReactNode {
	const counts: string[] = [];
	/*
	 * A collection reports what is on disk, everything else what it holds.
	 *
	 * `collected` is the number of this collection's skills found among the loose ones, which is the
	 * only evidence a collection leaves that it was installed — it has no directory. For a plugin,
	 * `skillCount` is what the loader counted once it is installed and what the index claimed before.
	 */
	const skills = item.collected > 0 ? item.collected : item.skillCount;
	if (skills) counts.push(`${skills} 个技能`);
	if (item.serverCount) counts.push(`${item.serverCount} 个服务`);

	const clients = item.clients ?? [];
	if (counts.length === 0 && clients.length === 0 && !item.downloads) return null;

	return (
		<div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-faint">
			{clients.map((client) => (
				<span
					key={client}
					className="rounded-md border border-line-soft px-1.5 py-px leading-[1.5] text-ink-muted"
				>
					{CLIENT_LABEL[client] ?? client}
				</span>
			))}
			{counts.map((count) => (
				<span key={count} className="tabular-nums">
					{count}
				</span>
			))}
			{/*
			 * A popularity signal, not a fact about the bundle — and shown only once it means
			 * anything. "0 次安装" on a new entry reads as a verdict on it rather than as its age.
			 */}
			{(item.downloads ?? 0) > 0 && <span className="tabular-nums">↓ {item.downloads}</span>}
		</div>
	);
}
