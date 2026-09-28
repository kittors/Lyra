/**
 * Rows under a menu's divider sit on the menu's gutter.
 *
 * A popover's footer slot has no gutter of its own — not everything put there is a row — so rows go
 * in `MenuFooter`. Without it the project picker's 新建项目 / 不在项目中工作 filled edge to edge on
 * hover and sat 6px left of the projects above them, and the model menu made up a 4px gutter of its
 * own. The painted geometry is measured in `e2e/menu-footer-inset-probe.ts`; these hold the structure.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, test } from "node:test";
import { createElement as h } from "react";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { DockScope, SessionScope } from "../../src/app/session-scope.tsx";
import { ProjectPicker } from "../../src/features/modals/ProjectPicker.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import { mount, type Mounted } from "../helpers/mount.ts";

let view: Mounted | undefined;

afterEach(async () => {
	await view?.unmount();
	view = undefined;
});

test("the project picker's footer rows sit in the menu gutter, the projects in the list", async () => {
	const previous = useApp.getState();
	Object.defineProperty(window, "lyra", { configurable: true, value: { sessions: { list: async () => [] } } });
	useApp.setState({
		settings: { projects: [{ id: "/work/alpha", path: "/work/alpha", name: "alpha-app", pinned: true, lastOpenedAt: 1 }], editor: {} } as unknown as AppState["settings"],
	});
	try {
		const anchor = { x: 0, y: 0, width: 10, height: 10 } as unknown as Parameters<typeof ProjectPicker>[0]["anchor"];
		const picker = h(DockScope.Provider, { value: "@draft" }, h(SessionScope.Provider, { value: null }, h(ProjectPicker, { anchor, onClose() {} })));
		view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, { children: picker }) }));
		const rows = [...document.querySelectorAll(".ly-item")].map((row) => ({
			text: row.textContent?.trim(),
			footer: Boolean(row.closest(".ly-menu-foot")),
			list: Boolean(row.closest(".ly-menu-scroll")),
		}));
		assert.deepEqual(rows.filter((row) => row.footer).map((row) => row.text), ["新建项目", "不在项目中工作"]);
		assert.deepEqual(rows.filter((row) => row.list).map((row) => row.text), ["alpha-app"]);
	} finally {
		useApp.setState(previous, true);
		Reflect.deleteProperty(window, "lyra");
	}
});

test("no popover puts menu rows in its footer without MenuFooter", () => {
	const root = join(import.meta.dirname, "../../src");
	const offenders: string[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (path.endsWith(".tsx")) {
				const source = readFileSync(path, "utf8");
				for (const match of source.matchAll(/\bfooter=\{/g)) {
					// Far enough to reach the slot's first row, short of whatever follows the prop.
					const slot = source.slice(match.index, match.index + 400);
					const row = slot.indexOf("<MenuItem");
					const footer = slot.indexOf("<MenuFooter");
					if (row !== -1 && (footer === -1 || footer > row)) offenders.push(relative(root, path));
				}
			}
		}
	};
	walk(root);
	assert.deepEqual(offenders, []);
});
