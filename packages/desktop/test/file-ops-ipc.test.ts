/**
 * What the file operations tell the panel when they refuse, in the interface language.
 *
 * Through the real IPC handlers, with Electron stood in for. The refusal for a path outside every
 * project used to be a module constant — the one shape that cannot follow a language change, since
 * it is settled when the file loads — so the language is switched here between calls to the same
 * handlers, with nothing registered again.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setInterfaceLocaleSource, type NativeLocale } from "../electron/i18n.ts";

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const fixtureUrl = `data:text/javascript,${encodeURIComponent(`
export const handlers = new Map();
export const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
export const shell = { trashItem: async () => { throw new Error("the bin is full"); } };
`)}`;
const source = new URL("../electron/ipc/file-ops.ts", import.meta.url).href;
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (context.parentURL === source && specifier === "electron") return { url: fixtureUrl, shortCircuit: true };
		return nextResolve(specifier, context);
	},
});
const fixture: { handlers: Map<string, Handler> } = await import(fixtureUrl);
const { registerFileOpsIpc } = await import("../electron/ipc/file-ops.ts");
hooks.deregister();

const root = await mkdtemp(join(tmpdir(), "lyra-file-ops-"));
after(() => rm(root, { recursive: true, force: true }));
registerFileOpsIpc({ projectPath: (target) => (target.startsWith(root) ? target : null) });

let language: NativeLocale = "zh-CN";
setInterfaceLocaleSource(() => language);
after(() => setInterfaceLocaleSource(() => "zh-CN"));

function call(name: string, ...args: unknown[]): Promise<unknown> {
	const handler = fixture.handlers.get(name);
	assert.ok(handler, `${name} is registered`);
	return handler({}, ...args);
}

test("a refusal is worded when it is given, in the language set at that moment", async () => {
	await writeFile(join(root, "notes.md"), "");
	await mkdir(join(root, "folder"));

	language = "en";
	assert.deepEqual(await call("files:create", "/elsewhere", "a.txt", "file"), {
		ok: false,
		error: "That path is not inside an open project",
		code: "denied",
	});
	assert.deepEqual(await call("files:create", root, "notes.md", "file"), { ok: false, code: "exists", error: "“notes.md” already exists" });
	assert.deepEqual(await call("files:create", root, "", "file"), { ok: false, error: "A name cannot be empty", code: "invalid" });
	assert.deepEqual(await call("files:rename", join(root, "folder"), join(root, "folder", "inner")), {
		ok: false,
		code: "descendant",
		error: "A folder cannot be moved into itself",
	});
	assert.deepEqual(await call("files:trash", [join(root, "notes.md")]), { ok: false, error: "Could not delete “notes.md”: the bin is full" });

	language = "ja";
	assert.deepEqual(await call("files:create", "/elsewhere", "a.txt", "file"), {
		ok: false,
		error: "このパスは開いているプロジェクトの中にありません",
		code: "denied",
	});
	assert.deepEqual(await call("files:trash", [join(root, "notes.md")]), { ok: false, error: "「notes.md」を削除できませんでした：the bin is full" });

	language = "zh-CN";
	assert.deepEqual(await call("files:create", root, "notes.md", "file"), { ok: false, code: "exists", error: "「notes.md」已存在" });
});
