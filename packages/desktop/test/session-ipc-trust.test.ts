import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { SessionStore } from "@lyra/core";

interface Contents { mainFrame: object }
interface Event { sender: Contents; senderFrame: object }
type Handler = (event: Event, ...args: unknown[]) => unknown;

// Execute the real IPC handlers while replacing Electron and their side effects.
const fixtureUrl = `data:text/javascript,${encodeURIComponent(`
export const handlers = new Map();
export const registered = new Set();
export const ipcMain = { handle: (name, handler) => handlers.set(name, handler) };
export const isAppWindowContents = contents => registered.has(contents);
export const grantArtifactRead = () => {};
export const sessionDelivery = async () => ({ files: [] });
export const undoDeliveryFile = async () => ({ ok: true });
export const listSessionServices = () => [];
export const stopSessionService = () => ({ ok: true });
`)}`;
const sources = new Set(["delivery", "running-services"].map(name => new URL(`../electron/ipc/${name}.ts`, import.meta.url).href));
const replacements = new Set(["electron", "../window.ts", "../readable-artifacts.ts", "../turn-delivery.ts", "../session-services.ts"]);
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (context.parentURL && sources.has(context.parentURL) && replacements.has(specifier)) return { url: fixtureUrl, shortCircuit: true };
		return nextResolve(specifier, context);
	},
});
const fixture: { handlers: Map<string, Handler>; registered: Set<Contents> } = await import(fixtureUrl);
const { registerDeliveryIpc } = await import("../electron/ipc/delivery.ts");
const { registerRunningServicesIpc } = await import("../electron/ipc/running-services.ts");
hooks.deregister();
const focused = { mainFrame: {} };
const background = { mainFrame: {} };
fixture.registered.add(focused);
fixture.registered.add(background);
const store = new SessionStore();
registerDeliveryIpc(() => store);
registerRunningServicesIpc();

const requests = [
	{ name: "delivery:get", args: ["session", 1] },
	{ name: "delivery:undo", args: ["session", 1, "file.txt"] },
	{ name: "services:list", args: ["session"] },
	{ name: "services:stop", args: ["session", "service", false] },
];

for (const request of requests) {
	test(`${request.name} accepts registered background windows and rejects foreign contents and child frames`, async () => {
		const handler = fixture.handlers.get(request.name);
		assert.ok(handler);
		for (const sender of [focused, background]) {
			await assert.doesNotReject(async () => handler({ sender, senderFrame: sender.mainFrame }, ...request.args));
		}
		const foreign = { mainFrame: {} };
		await assert.rejects(async () => handler({ sender: foreign, senderFrame: foreign.mainFrame }, ...request.args), /无效的/);
		await assert.rejects(async () => handler({ sender: background, senderFrame: {} }, ...request.args), /无效的/);
	});
}
