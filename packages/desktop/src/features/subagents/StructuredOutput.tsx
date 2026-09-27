/**
 * A sub-agent's structured reply, drawn by its shape rather than printed as JSON (16 §6.1).
 *
 * An agent that declared an output schema yields an object, and the object is the point: the
 * parent reads `agent://<id>/passed` without re-reading prose. Nothing here knows the schema — it
 * reads the value. A schema is what the parent agreed with the sub-agent; the person looking at
 * the pane did not sign it and should not have to.
 *
 * 从前的画法是「每个值按类型套一个容器」：记录列表是表格、长文本是折叠、键名一律用等宽小字印出来。
 * 在一个三百来像素宽的面板里，表格的四列把「问题」那一栏挤成每行四个字，路径那一栏横着滚；报告
 * 默认折起来、只露八十个字；`summary`、`findings`、`severity` 这些给模型看的键名顶在每一段上面。
 * 读起来是在看一份数据库导出，不是一份回报。
 *
 * 现在按「一个人怎么读回报」来排：
 *
 *   - `summary` 是开头那段话，不带标签——它就是结论。
 *   - 是非（`passed`）是顶上的一枚章：过了还是没过，第一眼就该知道。
 *   - 一列记录是一条一条的，不是表格：严重度和位置在第一行，问题本身独占整行宽度，其余的小一号跟在
 *     后面。带严重度的按轻重排，最该先读的在最上面。
 *   - 长文本（报告、结构说明）直接展开成 Markdown——那就是交付物，要读的，不该还得先点一下。
 *   - 键名换成人话；认不得的键把下划线和驼峰拆开，照原样写。
 */

import { translate } from "../../i18n/translate.ts";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { Check, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { parseInline, type Inline } from "../../lib/markdown/inline.ts";

type Plain = Record<string, unknown>;

/** 长到该当成一段文章来读的，不再塞进一行里。 */
const SHORT_TEXT = 160;
/** 严重度从重到轻；认不得的排在最后，按原来的先后。 */
const SEVERITY_ORDER = ["critical", "high", "error", "medium", "warning", "low", "info", "note"];

const LABELS: Record<string, MessageKey> = {
	summary: "output.summary",
	findings: "output.findings",
	files: "output.files",
	architecture: "output.architecture",
	report: "output.report",
	failures: "output.failures",
	command: "output.command",
	steps: "output.steps",
	risks: "output.risks",
	unknowns: "output.unknowns",
	problem: "output.problem",
	failure: "output.failure",
	why: "output.why",
	message: "output.message",
	location: "output.location",
	name: "output.name",
	what: "output.what",
	passed: "output.passed",
};

const SEVERITY_LABELS: Record<string, MessageKey> = {
	critical: "output.severity.critical",
	high: "output.severity.high",
	medium: "output.severity.medium",
	low: "output.severity.low",
	error: "output.severity.error",
	warning: "output.severity.warning",
	info: "output.severity.info",
	note: "output.severity.note",
};

/** 一段文字怎么画，由用它的地方给——面板里是 Markdown。这个文件不去引对话域，免得多出一条依赖环。 */
type Prose = (text: string) => ReactNode;

const plainProse: Prose = (text) => <p className="whitespace-pre-wrap break-words">{text}</p>;

function isPlain(value: unknown): value is Plain {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordList(value: unknown): value is Plain[] {
	return Array.isArray(value) && value.length > 0 && value.every(isPlain);
}

/** 空字符串、null、undefined 都算没写；空数组不算——「没有」本身是个回答。 */
function present(value: unknown): boolean {
	if (value === null || value === undefined) return false;
	return typeof value !== "string" || value.trim() !== "";
}

/** 这个对象里有没有一个人能读的东西。`{ summary: "", files: [] }` 也能过 schema 校验，但什么都没说。 */
export function hasContent(value: unknown): boolean {
	if (typeof value === "string") return value.trim() !== "";
	if (typeof value === "number" || typeof value === "boolean") return true;
	if (Array.isArray(value)) return value.some(hasContent);
	if (isPlain(value)) return Object.values(value).some(hasContent);
	return false;
}

/** A path-shaped string is drawn in mono; the rest as prose. */
function looksLikePath(key: string, value: unknown): boolean {
	return typeof value === "string" && (/^(path|file|files?|location|command|dir|where)$/i.test(key) || /^[\w./@-]+\.[a-z]{1,5}(:\d+(-\d+)?)?$/i.test(value));
}

function labelOf(key: string): string {
	const known = LABELS[key];
	if (known) return translate(known);
	return key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
}

function rank(severity: unknown): number {
	const at = SEVERITY_ORDER.indexOf(String(severity).toLowerCase());
	return at === -1 ? SEVERITY_ORDER.length : at;
}

export function StructuredOutput({ output, prose = plainProse, warnings }: { output: Plain; prose?: Prose; warnings?: string[] }) {
	const entries = Object.entries(output).filter(([, value]) => present(value));
	const lead = typeof output.summary === "string" && output.summary.trim() ? output.summary.trim() : null;
	const flags = entries.filter(([, value]) => typeof value === "boolean") as [string, boolean][];
	const rest = entries.filter(([key, value]) => typeof value !== "boolean" && !(key === "summary" && lead));
	return (
		<div className="min-w-0 space-y-3" data-structured-output="">
			{flags.length > 0 && (
				<div className="flex flex-wrap items-center gap-1.5">
					{flags.map(([key, value]) => (
						<Flag key={key} name={key} value={value} />
					))}
				</div>
			)}
			{lead && (
				<div data-field="summary" data-kind="lead" className="min-w-0 text-ink">
					{prose(lead)}
				</div>
			)}
			{rest.map(([key, value]) => (
				<Field key={key} name={key} value={value} prose={prose} />
			))}
			{warnings && warnings.length > 0 && (
				<div data-output-warnings="" className="rounded-lg bg-card-hover/60 px-2.5 py-2 text-caption text-ink-faint">
					<p className="flex items-center gap-1.5">
						<TriangleAlert size={12} strokeWidth={2} aria-hidden className="shrink-0" />
						{translate("output.warnings", { n: warnings.length })}
					</p>
					<ul className="mt-1 space-y-0.5 pl-[18px]">
						{warnings.map((warning, index) => (
							// Read-only and positional.
							<li key={index} className="break-words">{warning}</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

/** 是非：`passed` 说「通过 / 没通过」，别的键说「键名 · 是 / 否」。颜色只给结论，不给别的是非。 */
function Flag({ name, value }: { name: string; value: boolean }) {
	if (name === "passed") {
		return (
			<span
				data-field={name}
				data-kind="flag"
				className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium ${value ? "bg-ok/12 text-ok" : "bg-danger/12 text-danger"}`}
			>
				{value ? <Check size={12} strokeWidth={2.4} aria-hidden /> : <X size={12} strokeWidth={2.4} aria-hidden />}
				{translate(value ? "output.passed" : "output.notPassed")}
			</span>
		);
	}
	return (
		<span data-field={name} data-kind="flag" className="inline-flex items-center gap-1 rounded-full bg-card-hover px-2 py-0.5 text-caption text-ink-muted">
			{labelOf(name)} · {translate(value ? "common.yes" : "common.no")}
		</span>
	);
}

function Field({ name, value, prose }: { name: string; value: unknown; prose: Prose }) {
	if (typeof value === "number") {
		return (
			<Row name={name} kind="number">
				<span className="tabular-nums">{value}</span>
			</Row>
		);
	}
	if (typeof value === "string") {
		if (value.length > SHORT_TEXT || value.includes("\n")) {
			return (
				<Section name={name} kind="long-text">
					<div className="min-w-0 text-ink">{prose(value)}</div>
				</Section>
			);
		}
		return (
			<Row name={name} kind="text">
				{looksLikePath(name, value) ? (
					<code className="font-mono text-detail text-ink [overflow-wrap:anywhere]">
						<PathText path={value} />
					</code>
				) : (
					<Rich text={value} />
				)}
			</Row>
		);
	}
	if (isRecordList(value)) return <Records name={name} rows={value} />;
	if (Array.isArray(value)) {
		if (value.length === 0) {
			return (
				<Row name={name} kind="empty">
					<span className="text-ink-faint">{translate("common.nothing")}</span>
				</Row>
			);
		}
		return (
			<Section name={name} kind="list" count={value.length}>
				<ul className="space-y-1">
					{value.map((item, index) => (
						// Read-only and positional; the index is what identifies them.
						<li key={index} className="flex gap-2 text-label leading-relaxed text-ink">
							<span aria-hidden className="mt-[0.7em] size-1 shrink-0 rounded-full bg-ink-faint" />
							<span className={`min-w-0 flex-1 break-words ${looksLikePath(name, item) ? "font-mono text-detail [overflow-wrap:anywhere]" : ""}`}>
								{isPlain(item) ? <StructuredOutput output={item} prose={prose} /> : looksLikePath(name, item) ? <PathText path={String(item)} /> : <Rich text={String(item)} />}
							</span>
						</li>
					))}
				</ul>
			</Section>
		);
	}
	if (isPlain(value)) {
		return (
			<Section name={name} kind="object">
				<div className="border-l-2 border-line-soft pl-3">
					<StructuredOutput output={value} prose={prose} />
				</div>
			</Section>
		);
	}
	return null;
}

/** 一行说完的：左边是它叫什么，右边是它。 */
function Row({ name, kind, children }: { name: string; kind: string; children: ReactNode }) {
	return (
		<div className="flex min-w-0 items-baseline gap-2.5 text-label" data-field={name} data-kind={kind}>
			<span className="shrink-0 text-caption text-ink-faint">{labelOf(name)}</span>
			<span className="min-w-0 flex-1 break-words text-ink">{children}</span>
		</div>
	);
}

/** 要占几行的：小标题在上，内容在下，占满整个宽度。 */
function Section({ name, kind, count, children }: { name: string; kind: string; count?: number; children: ReactNode }) {
	return (
		<section className="min-w-0" data-field={name} data-kind={kind}>
			<h4 className="mb-1.5 flex items-baseline gap-1.5 text-caption font-normal text-ink-faint">
				<span>{labelOf(name)}</span>
				{count !== undefined && <span className="tabular-nums">· {count}</span>}
			</h4>
			{children}
		</section>
	);
}

/**
 * 一列记录，一条一条地读。
 *
 * 带严重度的按轻重排（排序是稳定的，同一档里保持它交上来的先后）；`steps` 这种先后本身就是意思
 * 的，前面标上序号。
 */
function Records({ name, rows }: { name: string; rows: Plain[] }) {
	const severe = rows.every((row) => typeof row.severity === "string");
	const ordered = severe ? [...rows].sort((a, b) => rank(a.severity) - rank(b.severity)) : rows;
	const numbered = /^(steps|stages)$/i.test(name);
	return (
		<Section name={name} kind={severe ? "findings" : "records"} count={rows.length}>
			<ol className="divide-y divide-line-soft">
				{ordered.map((row, index) => (
					// Rows are positional.
					<Item key={index} row={row} index={numbered ? index + 1 : undefined} />
				))}
			</ol>
		</Section>
	);
}

/**
 * 一条记录。
 *
 * 第一行是「多严重、在哪儿」——扫一眼就知道该不该先看它；接着是它的名字（有的话）和它要说的那句话，
 * 占满一整行；剩下的几句小一号、带上它们叫什么，跟在后面。
 */
function Item({ row, index }: { row: Plain; index?: number }) {
	const severity = typeof row.severity === "string" ? row.severity : null;
	const line = typeof row.line === "number" ? row.line : null;
	const fields = Object.entries(row).filter(([key, value]) => key !== "severity" && present(value) && !(key === "line" && line !== null));
	const where = fields.filter(([key, value]) => typeof value === "string" && looksLikePath(key, value) && value.length <= SHORT_TEXT) as [string, string][];
	const title = fields.find(([key, value]) => typeof value === "string" && /^(name|title)$/i.test(key)) as [string, string] | undefined;
	const texts = fields.filter(([key, value]) => typeof value === "string" && !where.some(([other]) => other === key) && key !== title?.[0]) as [string, string][];
	const lists = fields.filter(([, value]) => Array.isArray(value)) as [string, unknown[]][];
	const scalars = fields.filter(([, value]) => typeof value === "number" || typeof value === "boolean") as [string, number | boolean][];
	const nested = fields.filter(([, value]) => isPlain(value)) as [string, Plain][];
	return (
		<li className="flex min-w-0 gap-2.5 py-2.5 first:pt-0.5 last:pb-0" data-item="" data-severity={severity ?? undefined}>
			{index !== undefined && <span className="w-4 shrink-0 pt-px text-right text-caption tabular-nums text-ink-faint">{index}</span>}
			<div className="min-w-0 flex-1 space-y-1">
				{(severity || where.length > 0) && (
					<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
						{severity && <Severity value={severity} />}
						{where.map(([key, value], at) => (
							<code key={key} data-item-where="" className="min-w-0 font-mono text-caption text-ink-muted [overflow-wrap:anywhere]">
								<PathText path={`${value}${at === 0 && line !== null && !/:\d+/.test(value) ? `:${line}` : ""}`} />
							</code>
						))}
					</div>
				)}
				{title && (
					<p className="break-words text-label font-medium text-ink">
						<Rich text={title[1]} />
					</p>
				)}
				{texts.map(([key, value], at) =>
					at === 0 ? (
						<p key={key} data-item-text="" className={`break-words whitespace-pre-wrap leading-relaxed ${title ? "text-detail text-ink-muted" : "text-label text-ink"}`}>
							<Rich text={value} />
						</p>
					) : (
						<p key={key} data-item-text="" className="break-words whitespace-pre-wrap text-detail leading-relaxed text-ink-muted">
							<span className="text-ink-faint">{labelOf(key)} · </span>
							<Rich text={value} />
						</p>
					),
				)}
				{lists.map(([key, value]) =>
					value.length === 0 ? null : (
						<div key={key} className="flex min-w-0 flex-wrap items-center gap-1" data-item-list={key}>
							{value.map((entry, at) => (
								// Read-only and positional.
								<span key={at} data-item-chip="" className={`max-w-full rounded-md bg-card-hover px-1.5 py-px text-caption text-ink-muted [overflow-wrap:anywhere] ${looksLikePath(key, entry) ? "font-mono" : ""}`}>
									{isPlain(entry) ? Object.values(entry).map(String).join(" · ") : looksLikePath(key, entry) ? <PathText path={String(entry)} /> : String(entry)}
								</span>
							))}
						</div>
					),
				)}
				{scalars.length > 0 && (
					<p className="text-caption text-ink-faint">
						{scalars.map(([key, value]) => `${labelOf(key)} ${typeof value === "boolean" ? translate(value ? "common.yes" : "common.no") : value}`).join(" · ")}
					</p>
				)}
				{nested.map(([key, value]) => (
					<div key={key} className="border-l-2 border-line-soft pl-3">
						<StructuredOutput output={{ [key]: value }} />
					</div>
				))}
			</div>
		</li>
	);
}

/** 严重度一枚小章：最重的那几档用危险色，其余由深到浅的灰——这个应用只有三种语义色，不为它再添一种。 */
function Severity({ value }: { value: string }) {
	const level = rank(value);
	const tone = level <= 2 ? "bg-danger/12 text-danger" : level <= 4 ? "bg-ink/10 text-ink" : "bg-ink/6 text-ink-muted";
	const known = SEVERITY_LABELS[value.toLowerCase()];
	return (
		<span data-item-severity={value} className={`inline-flex h-[18px] shrink-0 items-center rounded-[5px] px-1.5 text-caption font-medium leading-none ${tone}`}>
			{known ? translate(known) : value}
		</span>
	);
}

/**
 * 一句短话里的行内记号：`代码`、**加粗**、*强调*。
 *
 * 模型写这些字段的习惯和写正文一样——函数名套反引号、要紧的词加粗。一条记录里的一句话不值得交给
 * 整个 Markdown（它会包出段落、带上段距），但反引号原样摆着就是在读一份没排版的草稿。只认这几样，
 * 链接只留字、不给点：这里没有一个值得跳过去的地方。
 */
function Rich({ text }: { text: string }) {
	return <>{parseInline(text).map((token, index) => <Token key={index} token={token} />)}</>;
}

function Token({ token }: { token: Inline }): ReactNode {
	const children = (list: Inline[]) => list.map((child, index) => <Token key={index} token={child} />);
	switch (token.kind) {
		case "text":
			return token.text;
		case "code":
			return <code className="rounded-[4px] bg-card-hover px-1 py-px font-mono text-[0.9em] text-ink">{token.text}</code>;
		case "strong":
			return <strong className="font-semibold text-ink">{children(token.children)}</strong>;
		case "em":
			return <em>{children(token.children)}</em>;
		case "del":
			return <del>{children(token.children)}</del>;
		case "link":
		case "tag":
			return <>{children(token.children)}</>;
		case "break":
			return <br />;
		case "math":
			return token.tex;
		case "image":
			return token.alt;
	}
}

/**
 * 一条路径，折行时从斜杠后面折。
 *
 * 面板窄，`scripts/migrate-sessions.ts` 放不下一行时，从前是在 `.t` 和 `s` 中间断开——`break-all`
 * 见字就断。在每个斜杠后面留一个可断点，折下去的就是完整的一段；一段本身都放不下时才退回任意处断。
 */
function PathText({ path }: { path: string }) {
	const parts = path.split("/");
	return (
		<>
			{parts.map((part, index) => (
				// Positional and read-only.
				<span key={index}>
					{part}
					{index < parts.length - 1 && (
						<>
							/<wbr />
						</>
					)}
				</span>
			))}
		</>
	);
}
