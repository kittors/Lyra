import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { BUILTIN_AGENTS, type AgentDefinitionRecord, type AgentDefinitionSave } from "@lyra/core";
import { AgentDefinitionEditor } from "../../src/features/settings/AgentDefinitionEditor.tsx";
import { avatarResolver } from "../../src/store/agent-avatars.ts";
import { click, fire, mount } from "../helpers/mount.ts";

const record: AgentDefinitionRecord = { id: "editor-fixture", definition: BUILTIN_AGENTS[0], scope: "builtin", editable: true, customized: false, revision: "initial", raw: "", shadowedSources: [] };

test("a failed definition save retains the draft across navigation and never reports success", async () => {
	const previous = Object.getOwnPropertyDescriptor(window, "lyra");
	let submitted: AgentDefinitionSave | undefined; let saved = 0;
	Object.defineProperty(window, "lyra", { configurable: true, value: { agentDefinitions: { save: async (_project: string | null, input: AgentDefinitionSave) => { submitted = input; throw new Error("definition changed externally"); } } } });
	const props = { record, projectId: null, tools: ["read"], avatarOf: avatarResolver(BUILTIN_AGENTS), taken: [], onClose: () => {}, onSaved: () => { saved++; } };
	const view = await mount(h(AgentDefinitionEditor, props));
	try {
		const field = view.find<HTMLTextAreaElement>('[aria-label="智能体指令"]');
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set; assert.ok(setter);
		setter.call(field, "Unsaved instructions"); await fire(field, new Event("input", { bubbles: true }));
		await fire(view.find("form"), new Event("submit", { bubbles: true, cancelable: true }));
		assert.match(view.text(), /definition changed externally/); assert.equal(saved, 0);
		assert.equal(submitted?.revision, "initial"); assert.equal(submitted?.scope, "user");
		await view.rerender(null); await view.rerender(h(AgentDefinitionEditor, props));
		assert.equal(view.find<HTMLTextAreaElement>('[aria-label="智能体指令"]').value, "Unsaved instructions");
		await click(view.find('[aria-label="返回智能体"]'));
		const discard = view.all("button").find(button => (button.getAttribute("aria-label") ?? button.textContent) === "放弃修改"); assert.ok(discard); await click(discard);
	} finally { await view.unmount(); if (previous) Object.defineProperty(window, "lyra", previous); else Reflect.deleteProperty(window, "lyra"); }
});
