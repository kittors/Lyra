/**
 * Address-bar engines carry the mark each vendor publishes, not a drawing of it.
 *
 * Checking colours alone let hand-drawn marks through: the old Baidu paw was four circles in the
 * right blue. So each mark is pinned to the start of a path from its vendor's file, and a
 * `<circle>` — what approximations here were built from — fails the test outright.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { SearchEngineIcon } from "../../src/features/settings/SearchEngineIcon.tsx";
import { mount } from "../helpers/mount.ts";

const OFFICIAL = {
	google: { path: "M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92", colours: ["#4285F4", "#34A853", "#FBBC05", "#EA4335"] },
	bing: { path: "M11.4 0H0v11.4h11.4z", colours: ["#f26522", "#8dc63f", "#00aeef", "#ffc20e"] },
	baidu: { path: "M281.391672,253.227889 C330.249408,253.227889", colours: ["#2932E1"] },
	duckduckgo: { path: "M60.186 120.373c33.24 0 60.187-26.947", colours: ["#DE5833", "#3CA82B", "#14307E"] },
} as const;

test("preset engines draw the vendor's own paths, custom stays a lucide mark", async () => {
	const engines = Object.keys(OFFICIAL) as (keyof typeof OFFICIAL)[];
	const view = await mount(h("div", null, ...engines.map((engine) => h(SearchEngineIcon, { engine, key: engine })), h(SearchEngineIcon, { engine: "custom" })));
	for (const engine of engines) {
		const svg = view.find(`[data-search-engine="${engine}"]`);
		const paths = [...svg.querySelectorAll("path")].map((path) => path.getAttribute("d") ?? "");
		assert.ok(paths.some((d) => d.startsWith(OFFICIAL[engine].path)), `${engine} has the vendor's path`);
		for (const colour of OFFICIAL[engine].colours) assert.match(svg.innerHTML, new RegExp(colour), `${engine} keeps ${colour}`);
		assert.ok(!svg.querySelector("circle"), `${engine} is not built from circles`);
	}
	assert.equal(view.all("[data-search-engine]").length, engines.length);
	assert.ok(view.host.querySelector("svg.lucide"));
	await view.unmount();
});
