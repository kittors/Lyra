/**
 * Edit tasks, built from real Lyra source.
 *
 * The snippets are inlined rather than read from the working tree on purpose: a corpus that
 * changes when the repository changes cannot be compared against last week's baseline. They were
 * taken verbatim from the files named in `origin` at `main@9b0c7a7`.
 *
 * Each case is a triple — the file as the model sees it, an instruction in the words a user would
 * actually use, and the exact bytes the file must contain afterwards. Judgement is string equality
 * on the whole file: no model grades this, so a passing run means the edit really landed.
 *
 * The scenarios are the ones that break `str_replace` in practice, not a spread of syntax:
 * duplicated text that makes an anchor ambiguous, a long body where the model must decide how much
 * context to copy, indentation-sensitive insertion, and deletion (which has no replacement text to
 * anchor on).
 */

export interface EditCase {
	id: string;
	/** Which real file this came from. */
	origin: string;
	/** What the edit exercises, for the report. */
	scenario: "single-line" | "signature" | "insert" | "delete" | "block" | "ambiguous" | "indent" | "long-file" | "multi-point";
	path: string;
	before: string;
	instruction: string;
	after: string;
}

/** A 40-line excerpt so "read the whole file" is not a viable strategy. */
const LOOP_EXCERPT = `	let retries = 0;
	const stream = streamAssistant(config.provider, config.model, context, {
		signal: config.signal,
		thinking: config.thinking,
		maxTokens: config.maxTokens,
		temperature: config.temperature,
		retryAttempts: config.retryAttempts,
		onRetry: ({ delayMs, reason }) => {
			retries += 1;
			void emit({ type: "retry", attempt: retries, delayMs, reason });
		},
	});

	let started = false;

	while (true) {
		const next = await stream.next();
		if (next.done) return next.value;
		const event = next.value;

		switch (event.type) {
			case "start":
				started = true;
				await emit({ type: "message_start", message: event.partial });
				break;
			case "text_delta":
			case "thinking_delta":
			case "toolcall_delta":
			case "toolcall_end":
				await emit({ type: "message_update", message: event.partial, delta: event });
				break;
			case "done":
			case "error": {
				const message = event.message;
				if (!started) await emit({ type: "message_start", message });
				await emit({ type: "message_end", message });
				const tail = await stream.next();
				return tail.done ? tail.value : message;
			}
			default:
				break;
		}
	}
`;

export const CASES: EditCase[] = [
	{
		id: "01-single-line",
		origin: "packages/core/src/tools/read.ts",
		scenario: "single-line",
		path: "src/read.ts",
		before: `const DEFAULT_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
`,
		instruction: "把 DEFAULT_LIMIT 从 2000 改成 500。",
		after: `const DEFAULT_LIMIT = 500;
const MAX_LINE_LENGTH = 2000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
`,
	},

	{
		// `2000` appears twice on adjacent lines. A `str_replace` anchored on the number alone is
		// ambiguous, and the usual repair — widening the anchor — is exactly the failure loop we
		// are measuring.
		id: "02-ambiguous-anchor",
		origin: "packages/core/src/tools/read.ts",
		scenario: "ambiguous",
		path: "src/read.ts",
		before: `const DEFAULT_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
`,
		instruction: "把 MAX_LINE_LENGTH 从 2000 改成 4000。DEFAULT_LIMIT 不要动。",
		after: `const DEFAULT_LIMIT = 2000;
const MAX_LINE_LENGTH = 4000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
`,
	},

	{
		id: "03-signature",
		origin: "packages/core/src/prompt/system.ts",
		scenario: "signature",
		path: "src/system.ts",
		before: `export async function loadProjectInstructions(cwd: string): Promise<{ path: string; content: string }[]> {
	for (const name of INSTRUCTION_FILES) {
		const path = join(cwd, name);
		const content = await readFile(path, "utf8").catch(() => null);
		if (content?.trim()) return [{ path, content: content.trim() }];
	}
	return [];
}
`,
		instruction: "给 loadProjectInstructions 加一个可选参数 maxDepth: number = 1，签名改掉就行，函数体不用动。",
		after: `export async function loadProjectInstructions(cwd: string, maxDepth: number = 1): Promise<{ path: string; content: string }[]> {
	for (const name of INSTRUCTION_FILES) {
		const path = join(cwd, name);
		const content = await readFile(path, "utf8").catch(() => null);
		if (content?.trim()) return [{ path, content: content.trim() }];
	}
	return [];
}
`,
	},

	{
		// Pure insertion. The `str_replace` trap is widening into a REPLACE that retypes the kept
		// lines; any typo in the retyped text silently corrupts them.
		id: "04-insert",
		origin: "packages/core/src/tools/edit.ts",
		scenario: "insert",
		path: "src/edit.ts",
		before: `	async execute(args, ctx): Promise<ToolResult> {
		let absolute: string;
		try {
			absolute = resolveWorkspacePath(ctx.cwd, args.path);
		} catch (error) {
			return errorResult(error instanceof Error ? error.message : String(error));
		}
	}
`,
		instruction: "在 execute 方法体的第一行（let absolute 之前）插入一行：`\t\tconst startedAt = Date.now();`",
		after: `	async execute(args, ctx): Promise<ToolResult> {
		const startedAt = Date.now();
		let absolute: string;
		try {
			absolute = resolveWorkspacePath(ctx.cwd, args.path);
		} catch (error) {
			return errorResult(error instanceof Error ? error.message : String(error));
		}
	}
`,
	},

	{
		// Deletion has no replacement text, so `str_replace` needs an empty `new_string` — which
		// models frequently get wrong by leaving a blank line behind.
		id: "05-delete",
		origin: "packages/core/src/runtime/hooks.ts",
		scenario: "delete",
		path: "src/hooks.ts",
		before: `			const child = spawn(hook.command, {
				cwd,
				shell: systemShell().file,
				env: {
					...process.env,
					DW_TOOL: String(payload.toolName ?? ""),
					DW_EVENT: hook.event,
					DW_ARGS: JSON.stringify(payload.args ?? {}),
					DW_CWD: cwd,
				},
			});
`,
		instruction: "删掉 DW_ARGS 那一行环境变量，其他都保留。",
		after: `			const child = spawn(hook.command, {
				cwd,
				shell: systemShell().file,
				env: {
					...process.env,
					DW_TOOL: String(payload.toolName ?? ""),
					DW_EVENT: hook.event,
					DW_CWD: cwd,
				},
			});
`,
	},

	{
		id: "06-block-replace",
		origin: "packages/core/src/skills/loader.ts",
		scenario: "block",
		path: "src/loader.ts",
		before: `export function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } | null {
	const normalized = raw.replace(/\\r\\n/g, "\\n");
	if (!normalized.startsWith("---\\n")) return { frontmatter: {}, body: normalized };
	const end = normalized.indexOf("\\n---", 3);
	if (end === -1) return { frontmatter: {}, body: normalized };
	try {
		const frontmatter = (parseYaml(normalized.slice(4, end)) ?? {}) as Record<string, unknown>;
		return { frontmatter, body: normalized.slice(end + 4).replace(/^\\n+/, "") };
	} catch {
		return null;
	}
}
`,
		instruction: "把 try/catch 里的 catch 分支改成返回 { frontmatter: {}, body: normalized } 而不是 null。只改 catch 里那一行。",
		after: `export function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } | null {
	const normalized = raw.replace(/\\r\\n/g, "\\n");
	if (!normalized.startsWith("---\\n")) return { frontmatter: {}, body: normalized };
	const end = normalized.indexOf("\\n---", 3);
	if (end === -1) return { frontmatter: {}, body: normalized };
	try {
		const frontmatter = (parseYaml(normalized.slice(4, end)) ?? {}) as Record<string, unknown>;
		return { frontmatter, body: normalized.slice(end + 4).replace(/^\\n+/, "") };
	} catch {
		return { frontmatter: {}, body: normalized };
	}
}
`,
	},

	{
		// Tab-indented, nested four levels. Reproducing this by hand is where whitespace drift
		// shows up.
		id: "07-indent-sensitive",
		origin: "packages/core/src/runtime/sub-agents.ts",
		scenario: "indent",
		path: "src/sub-agents.ts",
		before: `	private retire(): void {
		while (this.records.size >= MAX_KEPT) {
			let oldest: SubAgentRecord | null = null;
			for (const record of this.records.values()) {
				if (record.status === "running") continue;
				if (!oldest || (record.endedAt ?? record.startedAt) < (oldest.endedAt ?? oldest.startedAt)) oldest = record;
			}
			if (!oldest) return;
			this.records.delete(oldest.id);
		}
	}
`,
		instruction: "在 `if (!oldest) return;` 之后、`this.records.delete` 之前，插入一行日志：`\t\t\tconsole.debug(\"retiring\", oldest.id);`",
		after: `	private retire(): void {
		while (this.records.size >= MAX_KEPT) {
			let oldest: SubAgentRecord | null = null;
			for (const record of this.records.values()) {
				if (record.status === "running") continue;
				if (!oldest || (record.endedAt ?? record.startedAt) < (oldest.endedAt ?? oldest.startedAt)) oldest = record;
			}
			if (!oldest) return;
			console.debug("retiring", oldest.id);
			this.records.delete(oldest.id);
		}
	}
`,
	},

	{
		// 40 lines. The question this asks is how much context the model copies to be safe.
		id: "08-long-file",
		origin: "packages/core/src/agent/loop.ts",
		scenario: "long-file",
		path: "src/loop.ts",
		before: LOOP_EXCERPT,
		instruction: "把 `let started = false;` 改成 `let started = false; // set on the first stream event`",
		after: LOOP_EXCERPT.replace("\tlet started = false;\n", "\tlet started = false; // set on the first stream event\n"),
	},

	{
		// Two switch cases share the `break;` shape; anchoring on `break;` alone is ambiguous.
		id: "09-ambiguous-break",
		origin: "packages/core/src/agent/loop.ts",
		scenario: "ambiguous",
		path: "src/loop.ts",
		before: LOOP_EXCERPT,
		instruction: "把 `case \"start\":` 分支里的 `started = true;` 改成 `started = true; firstAt = Date.now();`",
		after: LOOP_EXCERPT.replace("\t\t\t\tstarted = true;\n", "\t\t\t\tstarted = true; firstAt = Date.now();\n"),
	},

	{
		id: "10-multi-line-block",
		origin: "packages/core/src/config/settings.ts",
		scenario: "block",
		path: "src/settings.ts",
		before: `export function resolveModel(settings: Settings, id: string | null) {
	if (!id) return null;
	for (const provider of settings.providers) {
		if (!provider.enabled) continue;
		const model = provider.models.find((m) => m.id === id);
		if (model) return { provider, model };
	}
	return null;
}
`,
		instruction: "让 resolveModel 在找不到时也搜索 disabled 的 provider：把 `if (!provider.enabled) continue;` 整行删掉。",
		after: `export function resolveModel(settings: Settings, id: string | null) {
	if (!id) return null;
	for (const provider of settings.providers) {
		const model = provider.models.find((m) => m.id === id);
		if (model) return { provider, model };
	}
	return null;
}
`,
	},
];

// ---------------------------------------------------------------------------
// Hard cases
//
// The first ten are all short excerpts, and on gemini-3.7-flash-high every format scored ~100% —
// no signal. Real edits are not 8-line snippets: they happen in long files, they touch several
// places at once, and the surrounding text repeats. These exist to make the formats disagree.
// ---------------------------------------------------------------------------

/** 60 lines of realistic switch/case with heavy repetition — anchors are ambiguous everywhere. */
const REPETITIVE = `export function describe(event: StreamEvent): string {
	switch (event.type) {
		case "start": {
			const label = "start";
			return label;
		}
		case "text_start": {
			const label = "text";
			return label;
		}
		case "text_delta": {
			const label = "text";
			return label;
		}
		case "text_end": {
			const label = "text";
			return label;
		}
		case "thinking_start": {
			const label = "thinking";
			return label;
		}
		case "thinking_delta": {
			const label = "thinking";
			return label;
		}
		case "thinking_end": {
			const label = "thinking";
			return label;
		}
		case "toolcall_start": {
			const label = "tool";
			return label;
		}
		case "toolcall_delta": {
			const label = "tool";
			return label;
		}
		case "toolcall_end": {
			const label = "tool";
			return label;
		}
		default: {
			const label = "unknown";
			return label;
		}
	}
}
`;

/** ~90 lines. Long enough that copying context is a real cost. */
const LONG_SETTINGS = `export const DEFAULT_APPEARANCE: AppearanceSettings = {
	theme: "dark",
	accent: "#339CFF",
	lightBackground: "#FFFFFF",
	lightForeground: "#1A1C1F",
	darkBackground: "#171717",
	darkForeground: "#EDEDED",
	uiFont: "Inter Variable",
	codeFont: "JetBrains Mono Variable",
	codeLightTheme: "lyra-light",
	codeDarkTheme: "lyra-dark",
	uiFontSize: 13,
	codeFontSize: 12,
	codeFontWeight: 400,
	codeLineHeight: 1.6,
	codeLetterSpacing: 0,
	contrast: 60,
	contentWidth: 640,
	pointerCursor: false,
	reduceMotion: "system",
	diffMarkers: "color",
	errorDetail: "compact",
	fontSmoothing: true,
};

export const DEFAULT_FORMATTING: FormattingSettings = {
	onSave: false,
	tabWidth: 2,
	useTabs: true,
	printWidth: 120,
	semi: true,
	singleQuote: false,
	trailingComma: "all",
	bracketSpacing: true,
	arrowParens: "always",
};

export const DEFAULT_SCREENSHOT_SETTINGS: ScreenshotSettings = {
	shortcut: "Alt+A",
	saveLocation: "",
	showInComposer: false,
	copyToClipboard: true,
	insertIntoComposer: false,
	openEditor: true,
};

export function settingsPath(): string {
	return join(lyraHome(), "settings.json");
}

export async function loadSettings(): Promise<Settings> {
	const raw = await readFile(settingsPath(), "utf8").catch(() => null);
	if (!raw) return { ...DEFAULT_SETTINGS };
	try {
		const parsed = JSON.parse(raw) as Partial<Settings>;
		return { ...DEFAULT_SETTINGS, ...parsed };
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export async function saveSettings(settings: Settings): Promise<void> {
	await mkdir(dirname(settingsPath()), { recursive: true });
	await writeFile(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
}
`;

CASES.push(
	{
		// Three separate edits in one call. str-replace can only carry one anchor per call, so it
		// must either make three calls or get creative — both cost round trips.
		id: "11-multi-point",
		origin: "packages/core/src/config/settings.ts",
		scenario: "multi-point",
		path: "src/settings.ts",
		before: LONG_SETTINGS,
		instruction: "三处修改：uiFontSize 改成 14；tabWidth 改成 4；DEFAULT_SCREENSHOT_SETTINGS 的 openEditor 改成 false。",
		after: LONG_SETTINGS
			.replace("\tuiFontSize: 13,\n", "\tuiFontSize: 14,\n")
			.replace("\ttabWidth: 2,\n", "\ttabWidth: 4,\n")
			.replace("\topenEditor: true,\n", "\topenEditor: false,\n"),
	},
	{
		// `const label = "text";` appears three times, `return label;` eleven times.
		id: "12-repetitive-target",
		origin: "packages/core/src/types/provider.ts",
		scenario: "ambiguous",
		path: "src/describe.ts",
		before: REPETITIVE,
		instruction: '把 `case "thinking_delta":` 分支里的 label 从 "thinking" 改成 "reasoning"。其他分支不要动。',
		after: REPETITIVE.replace(
			`		case "thinking_delta": {
			const label = "thinking";`,
			`		case "thinking_delta": {
			const label = "reasoning";`,
		),
	},
	{
		id: "13-repetitive-insert",
		origin: "packages/core/src/types/provider.ts",
		scenario: "ambiguous",
		path: "src/describe.ts",
		before: REPETITIVE,
		instruction: '在 `case "toolcall_end":` 分支的 `return label;` 之前插入一行 `\t\t\tconsole.debug(label);`',
		after: REPETITIVE.replace(
			`		case "toolcall_end": {
			const label = "tool";
			return label;`,
			`		case "toolcall_end": {
			const label = "tool";
			console.debug(label);
			return label;`,
		),
	},
	{
		// Deleting a whole block from a long file.
		id: "14-long-delete-block",
		origin: "packages/core/src/config/settings.ts",
		scenario: "delete",
		path: "src/settings.ts",
		before: LONG_SETTINGS,
		// 初版写的是「包括它前后的空行之一」——"之一"没说清是前是后，三次运行全部因此判失败。
		// 模型没做错，题目出错了。指令必须无歧义，否则评测测的是出题水平。
		instruction: "删掉整个 DEFAULT_SCREENSHOT_SETTINGS 常量声明（从 export 那行到 };  那行），以及紧跟在它后面的那一个空行。其他内容一律保留。",
		after: LONG_SETTINGS.replace(
			`export const DEFAULT_SCREENSHOT_SETTINGS: ScreenshotSettings = {
	shortcut: "Alt+A",
	saveLocation: "",
	showInComposer: false,
	copyToClipboard: true,
	insertIntoComposer: false,
	openEditor: true,
};

`,
			"",
		),
	},
	{
		// Two edits far apart in a long file: one near the top, one near the bottom.
		id: "15-far-apart",
		origin: "packages/core/src/config/settings.ts",
		scenario: "multi-point",
		path: "src/settings.ts",
		before: LONG_SETTINGS,
		instruction: "两处：把 accent 改成 \"#FF6B35\"；把 saveSettings 里的 JSON.stringify 缩进参数从 2 改成 \\t。",
		after: LONG_SETTINGS
			.replace('\taccent: "#339CFF",\n', '\taccent: "#FF6B35",\n')
			.replace("JSON.stringify(settings, null, 2)", 'JSON.stringify(settings, null, "\\t")'),
	},
);
