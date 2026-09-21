/**
 * The rules about an account that have nothing to do with the network or the disk.
 *
 * Split out because every one of them is a rule you only find out you got wrong by having someone
 * type something reasonable: an address pasted with a trailing slash, a GitHub Enterprise host that
 * is not `api.github.com`, the same account added twice under two spellings of the same URL. Rules
 * that can only be exercised by reaching a live GitLab are rules nobody tests, so none of these
 * reach anything.
 */

import type { ForgeAccount, ForgeIdentity, ForgeKind } from "./types.ts";

/**
 * A server address as typed, turned into one this app can key on.
 *
 * Bare hosts get `https://` because that is what everybody means and nobody types. The path is
 * dropped: people paste `https://gitlab.com/dashboard/merge_requests` or the API root itself, and
 * both are the same server. The exception is a self-hosted instance served from a sub-path —
 * `https://example.com/gitlab` is a real deployment shape — so a path is kept when it is not one
 * of the API roots we would have appended ourselves.
 *
 * Returns null for anything that is not a usable http(s) origin, which is the form the caller needs
 * to refuse the input rather than store something that will fail on every request afterwards.
 */
export function normalizeServer(raw: string): string | null {
	const text = raw.trim().replace(/\/+$/, "");
	if (!text) return null;

	/*
	 * A scheme that is not http(s) is refused, not prefixed.
	 *
	 * Testing only for `https?://` and adding the prefix otherwise turned `ftp://git.example.com`
	 * into `https://ftp//git.example.com` — a URL that parses, passes a protocol check, and has
	 * `ftp` as its host. It would have been stored, and every request against it would have failed
	 * somewhere far from the field that caused it.
	 */
	const scheme = /^([a-z][a-z\d+.-]*):\/\//i.exec(text);
	if (scheme && !/^https?$/i.test(scheme[1])) return null;

	let url: URL;
	try {
		url = new URL(scheme ? text : `https://${text}`);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	if (!url.hostname) return null;

	/*
	 * `api.github.com` is the one host where the API and the pages are different names.
	 *
	 * Someone who pastes the API root means github.com, and storing it as typed would give an
	 * account whose links all point at a JSON endpoint.
	 */
	if (url.hostname.toLowerCase() === "api.github.com") return "https://github.com";

	const path = url.pathname.replace(/\/+$/, "");
	const kept = API_ROOTS.some((root) => path.toLowerCase() === root) ? "" : path;
	return `${url.protocol}//${url.host}${kept}`;
}

/** Paths this app appends on its own, and therefore must not keep when someone pastes one back. */
const API_ROOTS = ["/api/v3", "/api/v4", "/api/v5", "/api/v1", "/api"];

/**
 * Where a host answers API calls, given its server address.
 *
 * Derived rather than stored so that it stays right when it changes: GitHub Enterprise moved from
 * `/api/v3` once already, and an installed copy of this app that had written the old one into every
 * account would have needed a migration to follow.
 *
 * GitHub is the awkward one. The public instance answers on a different hostname entirely, and
 * every self-hosted one answers under `/api/v3` on its own. There is no rule covering both, so it
 * is a special case, written down once, here.
 */
export function apiRoot(account: Pick<ForgeAccount, "kind" | "baseUrl">): string {
	const base = account.baseUrl.replace(/\/+$/, "");
	switch (account.kind) {
		case "github":
			return base === "https://github.com" ? "https://api.github.com" : `${base}/api/v3`;
		case "gitlab":
			return `${base}/api/v4`;
		case "gitee":
			return `${base}/api/v5`;
		case "gitea":
			return `${base}/api/v1`;
	}
}

/** The host, for a label or a tooltip. Falls back to the whole string if it will not parse. */
export function hostOf(baseUrl: string): string {
	try {
		return new URL(baseUrl).host;
	} catch {
		return baseUrl.replace(/^https?:\/\//, "");
	}
}

/**
 * What an account is called when the user did not say: the login, and only the login.
 *
 * 它从前是 `登录名 · 主机`，理由是同名歧义——一个人的工作 GitLab 和私人 GitHub 可能叫一样的名字。
 * 理由本身没错，错在把答案塞进了名字里，而两个读它的地方都得再把那截主机弄掉：
 *
 *   `AccountTabs` 里有个 `short()`，专门按 ` · ` 切开取前半截，因为整串对一枚标签页来说太长
 *   `ForgeSettings` 的第二行只说「标题行还没说的」，它认为标题行就是登录名——于是 label 带了主机
 *   之后，`login !== label` 成立，第二行又把登录名写了一遍
 *
 * 屏幕上的结果是一行 `kittors · github.com`，下面跟一行 `kittors`：两行三个词，说的是同一件事，
 * 而其中的 `github.com` 右边那枚徽章已经答过了。
 *
 * 所以歧义交回给那两个本来就在答它的地方：徽章说是哪一家，第二行在主机确实不是官方实例时说主机
 * （见 `identityOf`）。名字只管名字。已经存成旧格式的账号在读取时换过来——见 `freshLabel`。
 */
export function defaultLabel(identity: ForgeIdentity): string {
	return identity.login.trim() || identity.name.trim() || "账号";
}

/**
 * 存着的那个名字，除非它正是从前自动生成的那一串。
 *
 * 改 `defaultLabel` 只管以后新加的账号，磁盘上那些 `kittors · github.com` 一个都不会动——而它们
 * 正是这次要收拾的东西。所以读的时候认一次：值恰好等于旧格式生成的结果，就当它从来没被人改过，
 * 换成现在的默认。
 *
 * 判的是「等于旧的自动值」而不是「含有 ` · `」：自己把账号命名成「公司 · 前端」的人改过名了，
 * 那是他的名字，不能因为长得像就收走。和 `migrateAppearance` 认旧默认字体是同一条规矩。
 */
function freshLabel(stored: string, login: string, baseUrl: string): string {
	const name = stored.trim();
	const fresh = defaultLabel({ login, name: login, avatarUrl: null });
	if (!name) return fresh;
	return name === `${fresh} · ${hostOf(baseUrl)}` ? fresh : name;
}

/**
 * Whether two accounts are the same signed-in identity.
 *
 * Same host and same login, not same token: re-adding an account is nearly always someone
 * replacing an expired token, and answering that with a second tab for the same person is how a
 * list of accounts becomes a list of attempts.
 */
export function sameIdentity(a: Pick<ForgeAccount, "kind" | "baseUrl" | "login">, b: typeof a): boolean {
	return (
		a.kind === b.kind &&
		hostOf(a.baseUrl).toLowerCase() === hostOf(b.baseUrl).toLowerCase() &&
		a.login.trim().toLowerCase() === b.login.trim().toLowerCase()
	);
}

/**
 * Everything a stored file might be, reduced to accounts we can actually use.
 *
 * Written defensively because this file is on the user's disk and a partial write, a hand edit or
 * a version from a future build all have to end in a working app rather than a boot failure. An
 * entry missing anything essential is dropped, not defaulted: an account with no `baseUrl` would
 * otherwise become an account that fails every request forever, silently.
 */
export function parseAccounts(raw: unknown): ForgeAccount[] {
	const list = Array.isArray(raw) ? raw : Array.isArray((raw as { accounts?: unknown })?.accounts)
		? (raw as { accounts: unknown[] }).accounts
		: [];

	const out: ForgeAccount[] = [];
	for (const entry of list) {
		// A `null` in the array is not a hypothetical: a partial write leaves one, and reading
		// `.kind` off it threw — from the one function whose whole job is to survive a bad file.
		if (!entry || typeof entry !== "object") continue;
		const item = entry as Partial<ForgeAccount>;
		const kind = item.kind;
		if (!isKind(kind)) continue;
		const id = typeof item.id === "string" ? item.id.trim() : "";
		const baseUrl = typeof item.baseUrl === "string" ? normalizeServer(item.baseUrl) : null;
		if (!id || !baseUrl) continue;
		const login = typeof item.login === "string" ? item.login : "";
		out.push({
			id,
			kind,
			baseUrl,
			login,
			label: freshLabel(typeof item.label === "string" ? item.label : "", login, baseUrl),
			avatarUrl: typeof item.avatarUrl === "string" ? item.avatarUrl : null,
			addedAt: typeof item.addedAt === "number" ? item.addedAt : 0,
			// Absent means on. A file written before this field existed should not arrive silent.
			enabled: item.enabled !== false,
			...(typeof item.lastError === "string" && item.lastError ? { lastError: item.lastError } : {}),
		});
	}
	return out;
}

function isKind(value: unknown): value is ForgeKind {
	return value === "github" || value === "gitlab" || value === "gitee" || value === "gitea";
}

/**
 * A list with one account replaced or appended, in one operation.
 *
 * One function rather than an add and an update because the caller never actually knows which it
 * is doing — "sign in to this host as this person" is the same intent whether or not a tab for
 * them already exists, and the answer must be one tab either way.
 */
export function upsert(accounts: ForgeAccount[], next: ForgeAccount): ForgeAccount[] {
	const at = accounts.findIndex((a) => a.id === next.id || sameIdentity(a, next));
	if (at < 0) return [...accounts, next];
	const merged = [...accounts];
	// The existing id wins, so the token already filed under it stays reachable.
	merged[at] = { ...next, id: accounts[at].id };
	return merged;
}
