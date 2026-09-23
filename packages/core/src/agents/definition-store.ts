import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createRegistry } from "../capability/index.ts";
import type { AgentDefinition } from "../agents-builtin.ts";
import type { Settings } from "../config/settings.ts";
import { renderAgentDocument, validateAgentDraft, type AgentDefinitionRecord, type AgentDefinitionSave } from "./definition-document.ts";
import { renameWithRetry } from "../utils/atomic-write.ts";

const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");
const inside = (root: string, path: string) => { const part = relative(root, path); return !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`); };
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";

/** One desktop writer serializes definition mutations; revisions protect external editor changes. */
export class AgentDefinitionStore {
	private home: string;
	private tail: Promise<unknown> = Promise.resolve();
	private undo = new Map<string, { cwd: string | null; path: string; backup: string }>();
	constructor(home: string) { this.home = home; }
	private directory(scope: "user" | "project", cwd: string | null): string {
		if (scope !== "user" && scope !== "project") throw new Error("智能体范围无效");
		if (scope === "project" && !cwd) throw new Error("请先选择项目");
		return scope === "user" ? join(this.home, "agents") : join(cwd ?? "", ".lyra", "agents");
	}
	private async guard(path: string, scope: "user" | "project", cwd: string | null): Promise<void> {
		const root = resolve(scope === "user" ? this.home : cwd ?? "");
		const directory = this.directory(scope, cwd);
		if (!inside(directory, path) || dirname(path) !== directory) throw new Error("智能体路径越界");
		// Check every existing ancestor before mkdir, so a symlink cannot create files outside the root.
		for (const item of scope === "user" ? [root, directory, path] : [root, join(root, ".lyra"), directory, path]) {
			try { if ((await lstat(item)).isSymbolicLink()) throw new Error("智能体目录不允许符号链接"); }
			catch (error) { if (!missing(error)) throw error; }
		}
		await mkdir(directory, { recursive: true });
		if (!inside(await realpath(root), await realpath(directory))) throw new Error("智能体目录越界");
	}
	async list(cwd: string | null, settings?: Pick<Settings, "capabilityPreferences">): Promise<AgentDefinitionRecord[]> {
		const registry = createRegistry({ home: this.home, userHome: homedir() });
		const preferred = new Map(Object.entries(settings?.capabilityPreferences ?? {}));
		const result = await registry.load<AgentDefinition>("agent", { cwd, preferred });
		return Promise.all(result.items.map(async item => {
			const source = item.provenance;
			const scope = source.scope === "project" ? "project" : source.scope === "builtin" ? "builtin" : "user";
			const raw = scope === "builtin" ? "" : await readFile(source.path, "utf8");
			const shadowed = result.all.filter(other => other.name === item.name && other.provenance.path !== source.path);
			return { id: hash(source.path), scope, raw, revision: hash(raw || JSON.stringify(item)),
				definition: { ...item, source: scope === "project" ? "workspace" : scope },
				editable: scope === "builtin" || source.provider === "native" && dirname(source.path) === this.directory(scope, cwd),
				customized: shadowed.some(other => other.provenance.scope === "builtin"),
				shadowedSources: shadowed.map(other => other.provenance.scope),
			};
		}));
	}
	async read(cwd: string | null, id: string, settings?: Pick<Settings, "capabilityPreferences">): Promise<AgentDefinitionRecord> {
		const record = (await this.list(cwd, settings)).find(item => item.id === id);
		if (!record) throw new Error("智能体已改变，请重新加载");
		return record;
	}
	private serialize<T>(action: () => Promise<T>): Promise<T> {
		const pending = this.tail.then(action, action);
		this.tail = pending.then(() => undefined, () => undefined);
		return pending;
	}
	save(cwd: string | null, input: AgentDefinitionSave, tools: readonly string[], settings?: Pick<Settings, "capabilityPreferences">): Promise<void> {
		return this.serialize(async () => {
			if (!input || typeof input !== "object") throw new Error("智能体请求无效");
			const records = await this.list(cwd, settings);
			const current = input.id ? records.find(item => item.id === input.id) : undefined;
			const template = input.copyFrom ? records.find(item => item.id === input.copyFrom) : current;
			if (input.copyFrom && !template) throw new Error("原智能体已改变，请重新加载");
			if (input.id && (!current || !current.editable || current.revision !== input.revision)) throw new Error("定义已被修改，请重新加载；当前草稿仍保留");
			const allowed = template?.definition.tools;
			validateAgentDraft(input.draft, [...tools, ...(Array.isArray(allowed) ? allowed : [])], current?.definition);
			if (!current && records.some(item => item.definition.name === input.draft.name)) throw new Error("调用名已存在，请编辑原智能体或使用新名称");
			const scope = current?.scope === "builtin" ? "user" : current?.scope ?? input.scope;
			if (current && current.scope !== "builtin" && input.scope !== current.scope) throw new Error("请通过复制改变生效范围");
			const directory = this.directory(scope, cwd);
			// Resolve the registered source again; names are not necessarily existing filenames.
			const registry = createRegistry({ home: this.home, userHome: homedir() });
			const sources = await registry.load<AgentDefinition>("agent", { cwd, preferred: new Map(Object.entries(settings?.capabilityPreferences ?? {})) });
			const original = current && current.scope !== "builtin" ? sources.items.find(item => hash(item.provenance.path) === current.id)?.provenance.path : undefined;
			const path = original ?? join(directory, `${input.draft.name}.md`);
			await this.guard(path, scope, cwd);
			const raw = renderAgentDocument(input.draft, template?.raw || undefined, template?.scope === "builtin" ? template.definition : undefined);
			const temporary = join(directory, `.${randomUUID()}.tmp`);
			await writeFile(temporary, raw, { flag: "wx", mode: 0o600 });
			try {
				await this.guard(path, scope, cwd);
				if (original) {
					if (hash(await readFile(path, "utf8")) !== current?.revision) throw new Error("定义已被修改，请重新加载；当前草稿仍保留");
					// On Windows a scanner holds a file it has just seen written for a moment; wait that out.
					await renameWithRetry(temporary, path);
				} else await link(temporary, path);
			} finally { await unlink(temporary).catch(error => { if (!missing(error)) throw error; }); }
		});
	}
	remove(cwd: string | null, id: string, revision: string, settings?: Pick<Settings, "capabilityPreferences">): Promise<string> {
		return this.serialize(async () => {
			const record = await this.read(cwd, id, settings);
			if (!record.editable || record.scope === "builtin" || revision !== record.revision) throw new Error("定义已改变或不可删除，请重新加载");
			const result = await createRegistry({ home: this.home, userHome: homedir() }).load<AgentDefinition>("agent", { cwd, preferred: new Map(Object.entries(settings?.capabilityPreferences ?? {})) });
			const path = result.items.find(item => hash(item.provenance.path) === id)?.provenance.path;
			if (!path) throw new Error("智能体不存在");
			await this.guard(path, record.scope, cwd);
			if (hash(await readFile(path, "utf8")) !== revision) throw new Error("定义已被修改，请重新加载");
			const token = randomUUID(), backup = join(dirname(path), `.${token}.deleted`);
			await renameWithRetry(path, backup);
			this.undo.set(token, { cwd, path, backup });
			return token;
		});
	}
	restore(cwd: string | null, token: string): Promise<void> {
		return this.serialize(async () => {
			const item = this.undo.get(token);
			if (!item || item.cwd !== cwd) throw new Error("撤销记录不存在");
			const scope = dirname(item.path) === this.directory("user", cwd) ? "user" : "project";
			await this.guard(item.path, scope, cwd);
			await this.guard(item.backup, scope, cwd);
			await link(item.backup, item.path);
			await unlink(item.backup);
			this.undo.delete(token);
		});
	}
}
