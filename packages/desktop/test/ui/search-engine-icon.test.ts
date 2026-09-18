/**
 * Address-bar engines carry the vendor's colour mark, not a monochrome stand-in.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { SearchEngineIcon } from "../../src/features/settings/SearchEngineIcon.tsx";
import { mount } from "../helpers/mount.ts";

test("preset engines ship official colour SVG, custom stays a lucide mark", async () => {
	const view = await mount(
		h(
			"div",
			null,
			h(SearchEngineIcon, { engine: "google" }),
			h(SearchEngineIcon, { engine: "bing" }),
			h(SearchEngineIcon, { engine: "baidu" }),
			h(SearchEngineIcon, { engine: "duckduckgo" }),
			h(SearchEngineIcon, { engine: "custom" }),
		),
	);
	const google = view.find('[data-search-engine="google"]');
	const bing = view.find('[data-search-engine="bing"]');
	const baidu = view.find('[data-search-engine="baidu"]');
	const duck = view.find('[data-search-engine="duckduckgo"]');
	assert.match(google.innerHTML, /#4285F4/);
	assert.match(google.innerHTML, /#34A853/);
	assert.match(google.innerHTML, /#FBBC05/);
	assert.match(google.innerHTML, /#EA4335/);
	assert.match(bing.innerHTML, /#0087D4/);
	assert.match(bing.innerHTML, /#8CD600/);
	assert.match(baidu.innerHTML, /#2932E1/);
	assert.match(duck.innerHTML, /#DE5833/);
	assert.equal(view.all("[data-search-engine]").length, 4);
	assert.ok(view.host.querySelector("svg.lucide"));
	await view.unmount();
});
