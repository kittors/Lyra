/**
 * Notices the app gives once and never again, remembered across launches.
 *
 * A file of its own in the profile rather than a settings field: nothing here is something a
 * person sets, and a settings schema change to record "it has been said" would be weight for no
 * reason. Unreadable or malformed means nothing has been said yet — the cost of that is one notice
 * repeated, never a failure on the path that wanted to show it.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface HintStore {
	shown(name: string): boolean;
	remember(name: string): void;
}

export function hintStore(file: string): HintStore {
	const read = (): Record<string, unknown> => {
		try {
			const value: unknown = JSON.parse(readFileSync(file, "utf8"));
			return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
		} catch {
			return {};
		}
	};
	return {
		shown: (name) => read()[name] === true,
		remember: (name) => {
			try {
				mkdirSync(dirname(file), { recursive: true });
				writeFileSync(file, JSON.stringify({ ...read(), [name]: true }));
			} catch {
				// Not remembered means said again next time, which is the lesser problem.
			}
		},
	};
}
