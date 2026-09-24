/**
 * The pull request list, in a real window.
 *
 * The unit tests own the rules — what is grouped where, what counts as changed, what counts as
 * unread. What they cannot see is the half of this feature that only exists once it is laid out:
 * whether the icon is actually in the middle of the row it stands for, whether a group really
 * folds to nothing, and whether a refresh that changed nothing leaves the DOM alone.
 *
 * That last one is the reason this file exists. "Unchanged rows keep their object" is a claim
 * about React, and the only honest evidence for it is that the elements on screen are the same
 * elements afterwards — a memo that silently stops working looks identical in every other way,
 * and would quietly put a full re-render of the list on a 45-second timer.
 *
 * Nothing here asserts on the *contents* of a row. The seeded accounts point at hosts that cannot
 * resolve, so the list is always the seeded cache — which is also what a real machine shows while
 * a host is unreachable, and is the one state that does not depend on somebody's token.
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;

/**
 * Two signed-in accounts, on hosts that do not exist.
 *
 * `.invalid` is reserved by RFC 2606 and never resolves, which is deliberate: the pane must not
 * reach out to github.com every time this suite runs, and a fetch that always fails is what keeps
 * the list the seeded cache rather than a race between a network and a timer.
 *
 * Stored unencrypted, which is a shape the vault genuinely supports — a machine with no keyring
 * writes exactly this — so nothing here is a fixture the app would not otherwise read.
 */
const ACCOUNTS = [
	{ id: "acct-one", kind: "github", label: "kittors · one.invalid", baseUrl: "https://one.invalid", login: "kittors" },
	{ id: "acct-two", kind: "gitlab", label: "work · two.invalid", baseUrl: "https://two.invalid", login: "work" },
];

async function seed(home: string): Promise<void> {
	await mkdir(home, { recursive: true });
	await writeFile(
		join(home, "forges.json"),
		JSON.stringify({
			version: 1,
			entries: ACCOUNTS.map((account) => ({
				account: { ...account, avatarUrl: null, addedAt: 1, enabled: true },
				token: "not-a-real-token",
				encrypted: false,
			})),
		}),
		"utf8",
	);
}

/** Enough of a row for the pane to draw one; the validation on the way out of the cache is real. */
const CACHED = [
	{
		accountId: "acct-one",
		repo: "kittors/lyra",
		number: 1,
		title: "fix: 一个足够长的标题，长到需要在这一列里被裁掉",
		author: "kittors",
		avatarUrl: null,
		state: "OPEN",
		isDraft: false,
		url: "https://github.com/kittors/lyra/pull/1",
		createdAt: "2026-08-01T00:00:00Z",
		updatedAt: "2026-08-02T00:00:00Z",
		comments: 2,
		relation: "reviewing",
		additions: 16,
		deletions: 16,
		headRefName: "fix/something",
		checkState: "fail",
		reviewDecision: null,
	},
	{
		accountId: "acct-one",
		repo: "kittors/lyra",
		number: 2,
		title: "chore: bump",
		author: "someone",
		avatarUrl: null,
		state: "OPEN",
		isDraft: true,
		url: "https://github.com/kittors/lyra/pull/2",
		createdAt: "2026-07-01T00:00:00Z",
		updatedAt: "2026-07-02T00:00:00Z",
		comments: 0,
		relation: "authored",
		additions: 4,
		deletions: 1,
		headRefName: "chore/bump",
		checkState: "pass",
		reviewDecision: "APPROVED",
	},
	{
		accountId: "acct-two",
		repo: "farion1231/cc-switch",
		number: 3,
		title: "feat: 另一个仓库里的改动",
		author: "spock-wen",
		avatarUrl: null,
		state: "OPEN",
		isDraft: false,
		url: "https://github.com/farion1231/cc-switch/pull/3",
		createdAt: "2026-06-01T00:00:00Z",
		updatedAt: "2026-06-02T00:00:00Z",
		comments: 0,
		relation: "reviewed",
		additions: 0,
		deletions: 0,
		headRefName: null,
		checkState: null,
		reviewDecision: null,
	},
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

before(async () => {
	app = await startApp({ port: 9449, seed });

	// Seeded before the pane is ever opened, so it draws from this on its first frame — which is
	// also what happens whenever a host is unreachable, and what keeps this test the same either way.
	await app.evaluate(`(() => {
		localStorage.setItem("lyra.pull-requests.v3", ${JSON.stringify(JSON.stringify(CACHED))});
		localStorage.removeItem("lyra.pull-requests.folded.v1");
		return true;
	})()`);

	await app.evaluate(`(() => {
		const nav = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "拉取请求");
		if (!nav) throw new Error("no pull request entry in the sidebar");
		nav.click();
		return true;
	})()`);

	await waitForRows();
	// Let the refresh behind the cache land, so what follows measures a settled list rather than
	// one mid-swap. It either answers or fails; both leave rows on screen.
	await wait(8000);
});

after(async () => {
	await app?.stop();
});

async function waitForRows(): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt++) {
		const rows = await app.evaluate<number>(`document.querySelectorAll(".ly-pr-row").length`);
		if (rows > 0) return;
		await wait(250);
	}
	throw new Error("the list never drew a row");
}

test("the icon stands for the row, so it sits in the middle of it", async () => {
	const offsets = await app.evaluate<number[]>(`[...document.querySelectorAll(".ly-pr-row")].map((row) => {
		const icon = row.querySelector("svg");
		const r = row.getBoundingClientRect();
		const i = icon.getBoundingClientRect();
		return (i.top + i.height / 2) - (r.top + r.height / 2);
	})`);

	assert.ok(offsets.length > 0, "there is something to measure");
	for (const off of offsets) {
		// Half a pixel of slack for sub-pixel layout; anything more is the icon pinned to a line.
		assert.ok(Math.abs(off) <= 0.5, `icon is ${off.toFixed(2)}px off the row's centre`);
	}
});

test("a row says who, when, and how big without being opened", async () => {
	const shape = await app.evaluate<{ rows: number; faces: number; times: number; stats: number }>(`(() => {
		const rows = [...document.querySelectorAll(".ly-pr-row")];
		return {
			rows: rows.length,
			// The picture or the initial standing in for it — either way, the face's place is taken.
			faces: rows.filter((r) => r.querySelector("img, .rounded-full")).length,
			times: rows.filter((r) => r.querySelector("[data-ly-tip]")).length,
			stats: rows.filter((r) => /\\+\\d+/.test(r.innerText)).length,
		};
	})()`);

	assert.ok(shape.rows > 0);
	assert.equal(shape.faces, shape.rows, "every row carries its author");
	assert.equal(shape.times, shape.rows, "every row carries a time it can explain on hover");
	assert.ok(shape.stats > 0, "the line counts come from the same search as the row");
});

test("a group folds to nothing and remembers that it did", async () => {
	const folded = await app.evaluate<{ open: string; height: number; stored: string | null }>(`(async () => {
		const heading = document.querySelector('button[class~="group/head"][aria-expanded]');
		if (!heading) throw new Error("no group heading");
		const body = () => heading.parentElement.querySelector(".ly-reveal");
		heading.click();
		await new Promise((r) => setTimeout(r, 600));
		return {
			open: body().dataset.open,
			height: body().getBoundingClientRect().height,
			stored: localStorage.getItem("lyra.pull-requests.folded.v1"),
		};
	})()`);

	assert.equal(folded.open, "false");
	assert.equal(folded.height, 0, "folded is folded, not merely faded");
	assert.ok(folded.stored && folded.stored.length > 2, "and it is a preference, not a mood");

	const reopened = await app.evaluate<{ open: string; height: number }>(`(async () => {
		const heading = document.querySelector('button[class~="group/head"][aria-expanded]');
		heading.click();
		await new Promise((r) => setTimeout(r, 600));
		const body = heading.parentElement.querySelector(".ly-reveal");
		return { open: body.dataset.open, height: body.getBoundingClientRect().height };
	})()`);

	assert.equal(reopened.open, "true");
	assert.ok(reopened.height > 0);
});

test("a refresh that changes nothing does not redraw a single row", async () => {
	/*
	 * The claim under test is the one that makes a self-refreshing list affordable: an unchanged
	 * row keeps its object, so React keeps its element, so nothing about it is measured or painted
	 * again. Marking the elements and looking for the same marks afterwards is the only way to see
	 * that from outside — a broken memo produces an identical-looking list.
	 */
	await app.evaluate(`(() => {
		document.querySelectorAll(".ly-pr-row").forEach((row, i) => { row.dataset.probe = String(i); });
		const button = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "刷新");
		if (!button) throw new Error("no refresh control");
		button.click();
		return true;
	})()`);
	await wait(8000);

	const after = await app.evaluate<{ total: number; kept: number }>(`({
		total: document.querySelectorAll(".ly-pr-row").length,
		kept: document.querySelectorAll(".ly-pr-row[data-probe]").length,
	})`);

	assert.ok(after.total > 0);
	assert.equal(after.kept, after.total, "the rows on screen are the same elements they were");
});

test("the account tabs are a filter, not a decoration", async () => {
	/*
	 * The claim: rows from two hosts share one list, and a tab narrows it to one of them.
	 *
	 * Measured by counting rows rather than by reading state, because the failure this guards
	 * against is a tab that highlights and filters nothing — which looks identical from the inside
	 * and is exactly what happens if the filter is applied after grouping instead of before.
	 */
	const tabs = await app.evaluate<string[]>(`[...document.querySelectorAll("[aria-label='账号'] button")].map((b) => b.textContent.trim())`);
	assert.ok(tabs.some((t) => t.includes("全部")), "with two accounts there is a tab strip");
	assert.ok(tabs.length >= 3, `expected 全部 plus one tab per account, got ${JSON.stringify(tabs)}`);

	const counts = await app.evaluate<{ all: number; one: number; two: number }>(`(async () => {
		const tab = (name) => [...document.querySelectorAll("[aria-label='账号'] button")].find((b) => b.textContent.includes(name));
		const rows = () => document.querySelectorAll(".ly-pr-row").length;
		const settle = () => new Promise((r) => setTimeout(r, 350));

		const all = rows();
		tab("kittors").click();
		await settle();
		const one = rows();
		tab("work").click();
		await settle();
		const two = rows();
		tab("全部").click();
		await settle();
		return { all, one, two };
	})()`);

	assert.equal(counts.all, 3);
	assert.equal(counts.one, 2, "the two rows seen through the first account");
	assert.equal(counts.two, 1, "and the one seen through the second");
});

test("with no account left, the pane is the sign-in screen rather than an empty list", async () => {
	/*
	 * Last, because it signs both accounts out for real.
	 *
	 * Through the app's own IPC rather than by touching state: signing out has to remove the token
	 * from disk *and* take the tabs away, and only the real path does both. The distinction this
	 * asserts is the one the old pane got wrong — "nothing configured" used to render as a list
	 * with a grey line of text in it, which reads as a feature that is broken.
	 */
	const screen = await app.evaluate<{ rows: number; tabs: number; button: boolean; text: string }>(`(async () => {
		const accounts = await window.lyra.forge.accounts();
		for (const account of accounts) await window.lyra.forge.signOut(account.id);
		// This page's own: the conversations' screens stay mounted behind it, and a browser panel has
		// a 刷新 of its own that comes first in the document.
		const refresh = [...document.querySelectorAll('[data-view="pull-requests"] button')].find((b) => b.getAttribute("aria-label") === "刷新");
		refresh?.click();
		for (let i = 0; i < 40 && document.querySelectorAll(".ly-pr-row").length > 0; i++) {
			await new Promise((r) => setTimeout(r, 250));
		}
		return {
			rows: document.querySelectorAll(".ly-pr-row").length,
			tabs: document.querySelectorAll("[aria-label='账号'] button").length,
			// An icon button since the buttons were made one shape: its name is its label, not its text.
			button: [...document.querySelectorAll('[data-view="pull-requests"] button')].some((b) => b.getAttribute("aria-label") === "添加账号"),
			text: document.body.innerText,
		};
	})()`);

	assert.equal(screen.rows, 0, "rows nobody can act on are not left on screen");
	assert.equal(screen.tabs, 0);
	assert.ok(screen.button, "there is one thing to do here, and it is a button");
	assert.match(screen.text, /未添加代码托管账号/);
	// The message that used to be here named a CLI and a Homebrew command, which told a GitLab
	// user the app did not work rather than that they were one token away.
	assert.doesNotMatch(screen.text, /gh CLI|brew install/);
});
