import type { ServiceEndpoint } from "../shared/session-services.ts";

export interface ProcessEntry { pid: number; parent: number }
export function parseProcesses(text: string): ProcessEntry[] {
	return text.split(/\r?\n/).flatMap((line) => {
		const parts = line.trim().split(/\s+/).map(Number);
		return parts.length === 2 && parts.every(Number.isSafeInteger) && parts[0] > 0 && parts[1] >= 0 ? [{ pid: parts[0], parent: parts[1] }] : [];
	});
}
export function descendants(root: number, processes: ProcessEntry[]): Set<number> {
	const owned = new Set([root]);
	let changed = true;
	while (changed) { changed = false; for (const entry of processes) if (owned.has(entry.parent) && !owned.has(entry.pid)) { owned.add(entry.pid); changed = true; } }
	return owned;
}
function endpoint(pid: number, name: string): ServiceEndpoint[] {
	const match = /^(.*):(\d+)$/.exec(name);
	if (!match || pid <= 0) return [];
	const port = Number(match[2]), address = match[1].replace(/^\[|\]$/g, "");
	return port > 0 && port <= 65535 ? [{ pid, address, port }] : [];
}
export function parseLsof(text: string): ServiceEndpoint[] {
	let pid = 0;
	return text.split(/\r?\n/).flatMap((line) => {
		if (/^p\d+$/.test(line)) pid = Number(line.slice(1));
		return line.startsWith("n") ? endpoint(pid, line.slice(1)) : [];
	});
}
export function parseSs(text: string): ServiceEndpoint[] {
	return text.split(/\r?\n/).flatMap((line) => {
		const fields = line.trim().split(/\s+/);
		if (fields[0] !== "LISTEN") return [];
		return [...line.matchAll(/pid=(\d+)/g)].flatMap((match) => endpoint(Number(match[1]), fields[3] ?? ""));
	});
}
export function parseWindowsListeners(value: unknown): { processes: ProcessEntry[]; listeners: ServiceEndpoint[] } {
	if (!value || typeof value !== "object" || !("processes" in value) || !("listeners" in value) || !Array.isArray(value.processes) || !Array.isArray(value.listeners)) throw new Error("Windows 返回了无效的进程信息");
	const processes: ProcessEntry[] = [], listeners: ServiceEndpoint[] = [];
	for (const row of value.processes) {
		if (!row || typeof row !== "object" || typeof row.pid !== "number" || typeof row.parent !== "number" || !Number.isSafeInteger(row.pid) || !Number.isSafeInteger(row.parent)) throw new Error("无效进程记录");
		processes.push({ pid: row.pid, parent: row.parent });
	}
	for (const row of value.listeners) {
		if (!row || typeof row !== "object" || typeof row.pid !== "number" || typeof row.address !== "string" || typeof row.port !== "number") throw new Error("无效监听记录");
		listeners.push(...endpoint(row.pid, `${row.address}:${row.port}`));
	}
	return { processes, listeners };
}
export function localHost(address: string): string { return ["*", "0.0.0.0", "::"].includes(address) ? "127.0.0.1" : address; }
export function serviceUrl(listener: ServiceEndpoint, output: string): string | undefined {
	const host = localHost(listener.address);
	// oxlint-disable-next-line no-control-regex -- ANSI escape bytes terminate terminal URLs.
	for (const match of output.matchAll(/https?:\/\/[^\s\x1b<>"']+/g)) {
		try {
			const url = new URL(match[0]);
			if (Number(url.port || (url.protocol === "https:" ? 443 : 80)) !== listener.port) continue;
			const advertised = url.hostname.replace(/^\[|\]$/g, "");
			if (![host, "localhost", "127.0.0.1", "::1", "0.0.0.0", "::"].includes(advertised)) continue;
			url.hostname = host.includes(":") ? `[${host}]` : host;
			return url.href;
		} catch { /* Terminal output can contain incomplete URLs. */ }
	}
	return undefined;
}

/**
 * URLs the process printed itself, usable when the OS socket table is missing.
 *
 * Get-NetTCPConnection on Windows CI is allowed to fail (access, empty set, a 4s timeout). The
 * job is still listening; it already wrote `http://127.0.0.1:<port>`. Only local hosts with an
 * explicit port — the same constraint `serviceUrl` uses to reject docs.example.com:3000.
 */
export function advertisedEndpoints(pid: number, output: string): ServiceEndpoint[] {
	if (pid <= 0) return [];
	const found: ServiceEndpoint[] = [];
	const seen = new Set<string>();
	// oxlint-disable-next-line no-control-regex -- ANSI escape bytes terminate terminal URLs.
	for (const match of output.matchAll(/https?:\/\/[^\s\x1b<>"']+/g)) {
		try {
			const url = new URL(match[0]);
			if (!url.port) continue;
			const host = url.hostname.replace(/^\[|\]$/g, "");
			if (!["localhost", "127.0.0.1", "::1", "0.0.0.0", "::"].includes(host)) continue;
			const port = Number(url.port);
			if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) continue;
			const address = localHost(host === "localhost" ? "0.0.0.0" : host);
			const key = `${address}:${port}`;
			if (seen.has(key)) continue;
			seen.add(key);
			url.hostname = address.includes(":") ? `[${address}]` : address;
			found.push({ pid, address, port, url: url.href });
		} catch { /* Terminal output can contain incomplete URLs. */ }
	}
	return found;
}
