/**
 * The branch lines in Git 历史, where a commit has been expanded.
 *
 * `node --experimental-strip-types e2e/git-graph-probe.ts [dir]`
 *
 * The reported defect: expanding a commit inserts a diff list tens to hundreds of pixels tall, and
 * the topology lines — which were only ever drawn inside the 46px commit row — stopped at the top
 * of that block and resumed below it, leaving a gap the height of the expansion.
 *
 * So the measurement is geometric, not structural: it is not enough that a line element exists,
 * it has to actually span the expanded block. A `height="100%"` SVG in a flex row is exactly the
 * kind of thing that renders as zero when the parent's height is not resolved, so that is the
 * thing worth checking.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-gitgraph";
/** This repository — it has a real history with branches, which a fixture would not. */
const REPO = "/Users/kittors/Developer/opensource/Lyra";

let failures = 0;
function check(label: string, passed: boolean, evidence: string): void {
	if (!passed) failures++;
	process.stdout.write(`${passed ? "✓" : "✗"} ${label}\n    ${evidence}\n`);
}

async function seed(home: string): Promise<void> {
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1360, height: 940, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "e2e", name: "Lyra", path: REPO, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4541, token: null },
			appearance: { theme: "dark" },
		}),
	);
}

const app = await startApp({ port: 9503, seed });
const settle = (ms = 800) => new Promise((resolve) => setTimeout(resolve, ms));

interface Measured {
	found: boolean;
	note: string;
	/** How tall the expanded block is. */
	blockHeight: number;
	/** How tall the through-graph actually rendered. */
	graphHeight: number;
	/** How many lines it drew. */
	lines: number;
	/** How far the longest line actually reaches, in px. */
	drawn: number;
	/** Vertical gap between the commit row's graph and the through-graph, in px. */
	gapAbove: number;
	/** Vertical gap between the through-graph and the next commit's graph, in px. */
	gapBelow: number;
	/** Whether a skeleton was shown while the diff loaded. */
	skeleton: boolean;
	/** Every distinct stroke width drawn across the commit row and its expansion. */
	widths: string[];
	/** Every distinct opacity drawn across the same. */
	opacities: string[];
}

try {
	await mkdir(dir, { recursive: true });
	await settle(2600);

	// Into Git, then 历史.
	const switched = await app.evaluate<string>(
		/*
		 * The view tabs are found by position, not by their text.
		 *
		 * In a narrow pane the label is not rendered at all — only the icon — so matching on 「历史」
		 * finds nothing and the panel silently stays on 改动. The tab row is the one container whose
		 * children are exactly the four views, and history is the second of them.
		 */
		'(async () => {' +
			'const wait = (ms) => new Promise((r) => setTimeout(r, ms));' +
			'document.querySelector("button[data-ly-tip^=Git]")?.click();' +
			'await wait(1800);' +
			'const pane = document.querySelector(\'[data-pane="review"]\');' +
			'if (!pane) return "Git 面板没开";' +
			'const row = [...pane.querySelectorAll("div")].find((d) => d.children.length === 4 && [...d.children].every((c) => c.tagName === "BUTTON"));' +
			'if (!row) return "找不到视图标签行";' +
			'row.children[1].click();' +
			'await wait(2400);' +
			'return "已切换";' +
		'})()'
	);
	check("切到了历史视图", switched === "已切换", switched);
	await settle(2200);

	/*
	 * That the history list actually rendered, counted by commit rows.
	 *
	 * Not by looking for the word 「历史」 among the buttons: in a narrow pane the tab renders as an
	 * icon with no label, so that assertion was red on a correct build — a permanent false alarm
	 * sitting next to the checks that matter. What has to be true before measuring anything is that
	 * there are commits on screen, which is what this asks.
	 */
	const opened = await app.evaluate<number>(
		'(() => { const pane = document.querySelector(\'[data-pane="review"]\'); if (!pane) return 0; return [...pane.querySelectorAll("button")].filter((b) => b.offsetHeight === 46).length; })()',
	);
	check("历史列表渲染出了提交行", opened > 0, `${opened} 行提交`);

	/*
	 * 图占的宽度，从上往下。
	 *
	 * 从前是全表最宽那一行说了算：仓库里但凡有过一处八条分支并行，最上面那几条笔直的提交也要陪着让
	 * 出八条车道，一百来像素的空白，右边的标题被挤到截断——而定这个宽度的那次合并可能在三周以前。
	 * 现在每一行只和它上面的一样宽。见 `git/graph.ts` 的 `graphWidths`。
	 */
	const widths = await app.evaluate<number[]>(
		'(() => {' +
			'const pane = document.querySelector(\'[data-pane="review"]\');' +
			'if (!pane) return [];' +
			'return [...pane.querySelectorAll("[data-ly-graph]")].map((s) => Number(s.getAttribute("width")));' +
		'})()',
	);
	const widest = Math.max(...widths, 0);
	check(
		"最上面那几条笔直的提交，没有为下面的合并让出车道",
		widths.length > 2 && widths[0] < widest,
		`第一行 ${widths[0]}px，全表最宽 ${widest}px，省下 ${(widest - widths[0]).toFixed(0)}px 留给标题`,
	);
	check(
		"宽度只增不减，标题不会随滚动左右走",
		widths.every((w, i) => i === 0 || w >= widths[i - 1]),
		`取值依次为 ${[...new Set(widths)].join(", ")}`,
	);

	/*
	 * Expand a commit and watch what the loading state looks like before the diff arrives.
	 *
	 * Sampled immediately rather than after settling, because the skeleton is only up while the
	 * read is in flight — waiting for the list would be waiting for the skeleton to go away.
	 */
	const skeletonSeen = await app.evaluate<string>(
		/*
		 * A commit row, identified by the short hash it shows.
		 *
		 * Picking by icon matched the pane's own header buttons, and clicking one of those silently
		 * did something else — the probe then reported "no expanded block" for a commit it had never
		 * opened. Matching the hash did not work either: it renders flush against the version above
		 * it (`0.8.2824054c1Test`), so there is no word boundary to anchor on. The row height is
		 * fixed at 46 and is what the defect report itself names.
		 */
		'(async () => {' +
			'const wait = (ms) => new Promise((r) => setTimeout(r, ms));' +
			'const pane = document.querySelector(\'[data-pane="review"]\');' +
			'if (!pane) return "没有 Git 面板";' +
			'const rows = [...pane.querySelectorAll("button")].filter((b) => b.offsetHeight === 46 && (b.textContent || "").trim().length > 8);' +
			'if (rows.length === 0) return "没有提交行";' +
			// The first commit of this repository's history is the biggest one; any of the top few will do.
			'rows[0].click();' +
			'let seen = false;' +
			'for (let i = 0; i < 40; i++) { await wait(30); if (pane.querySelector(".ly-skeleton, [class*=skeleton]")) { seen = true; break; } }' +
			'return seen ? "看到骨架" : "没看到骨架（共 " + rows.length + " 行提交）";' +
		'})()'
	);
	await settle(2600);

	const measured = await app.evaluate<Measured>(
		'(() => {' +
			'const pane = document.querySelector(\'[data-pane="review"]\') || document;' +
			'const stretch = [...pane.querySelectorAll("div")].filter((d) => d.className && String(d.className).includes("items-stretch") && d.querySelector("svg"));' +
			// The tallest one: the commit rows are 46px and carry the same class, so taking the last
			// picked one of those and reported its height as though it were the expansion.
			'const block = stretch.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];' +
			'if (!block) return { found: false, note: "没找到展开区", blockHeight: 0, graphHeight: 0, lines: 0, gapAbove: -1, gapBelow: -1, skeleton: false };' +
			'const graph = block.querySelector("svg");' +
			'const blockBox = block.getBoundingClientRect();' +
			'const graphBox = graph ? graph.getBoundingClientRect() : { height: 0, top: 0 };' +
			'const lineEls = graph ? [...graph.querySelectorAll("line")] : [];' +
			'const lines = lineEls.length;' +
			// What the line actually spans on screen, which is the thing the eye judges.
			'const drawn = lineEls.length ? Math.round(Math.max(...lineEls.map((l) => l.getBoundingClientRect().height))) : 0;' +
			// The commit row's own graph sits directly above; its bottom should meet the through-graph's top.
			'const prev = block.previousElementSibling;' +
			'const above = prev ? prev.querySelector("svg") : null;' +
			'const gap = above ? Math.round(graphBox.top - above.getBoundingClientRect().bottom) : -1;' +
			/*
			 * And the seam on the other side, which the first version of this probe did not look at.
			 *
			 * It measured where the expansion joins the commit above it and reported a clean result
			 * while a six-pixel break sat at the bottom edge, in a screenshot, plainly visible. The
			 * next commit's graph is in the following sibling of the block's own wrapper.
			 */
			'const nextHost = block.parentElement ? block.parentElement.nextElementSibling : null;' +
			'const below = nextHost ? nextHost.querySelector("svg") : null;' +
			'const gapUnder = below ? Math.round(below.getBoundingClientRect().top - graphBox.bottom) : -1;' +
			/*
			 * Whether a lane looks like one line or several.
			 *
			 * A branch is drawn in pieces — into the dot, out of it, and on through the expansion
			 * below — by three separate elements in two separate svgs. If those pieces do not agree
			 * on width and opacity, the lane changes appearance at each boundary, which is what the
			 * eye picks up as a seam. Computed values, not attributes: the attribute may be absent
			 * and still paint, since the default opacity is 1.
			 *
			 * The dot is excluded. It is a node, not a segment of the line.
			 */
			'const painted = [...(above ? above.querySelectorAll("line, path") : []), ...(graph ? graph.querySelectorAll("line, path") : [])];' +
			'const widths = [...new Set(painted.map((el) => getComputedStyle(el).strokeWidth))];' +
			'const opacities = [...new Set(painted.map((el) => getComputedStyle(el).opacity))];' +
			'return {' +
			'widths, opacities,' +
			'found: true,' +
			'note: "展开区高 " + Math.round(blockBox.height) + "px",' +
			'blockHeight: Math.round(blockBox.height),' +
			'graphHeight: Math.round(graphBox.height),' +
			'lines,' +
			'drawn,' +
			'gapAbove: gap,' +
			'gapBelow: gapUnder,' +
			'skeleton: false,' +
			'};' +
			'})()',
	);

	process.stdout.write(`\n── 展开一条提交之后 ──\n  ${measured.note}，图谱高 ${measured.graphHeight}px，画了 ${measured.lines} 条线\n`);
	check("找到了展开区", measured.found, measured.note);
	check("展开区确实有高度（diff 列表撑开了）", measured.blockHeight > 40, `${measured.blockHeight}px`);
	check(
		"连线贯穿整个展开区，而不是塌成零高",
		measured.graphHeight >= measured.blockHeight - 2,
		`图谱 ${measured.graphHeight}px vs 展开区 ${measured.blockHeight}px`,
	);
	check("确实画出了线条", measured.lines > 0, `${measured.lines} 条`);
	check(
		"线条本身也画满了整个展开区，而不是画到一半就停",
		measured.drawn >= measured.blockHeight - 4,
		`线长 ${measured.drawn}px vs 展开区 ${measured.blockHeight}px`,
	);
	check(
		"和上一行的图谱首尾相接，没有缺口",
		measured.gapAbove >= -1 && measured.gapAbove <= 2,
		`间隙 ${measured.gapAbove}px`,
	);
	check(
		"和下一行的图谱首尾相接，没有缺口",
		measured.gapBelow >= -1 && measured.gapBelow <= 2,
		`间隙 ${measured.gapBelow}px`,
	);
	/*
	 * That opening a commit does not flash a placeholder.
	 *
	 * This check used to require the opposite — that a skeleton appear — which was right when the
	 * files took 557ms to arrive and wrong once they took 100. A placeholder shown for a tenth of a
	 * second is not information, it is a flicker, and it is a flicker at a different height than the
	 * content that replaces it. It is still rendered when a read genuinely drags on past
	 * `SLOW_ENOUGH_MS`; what is asserted here is that the common case does not pay for that.
	 */
	check(
		"展开不闪占位符，内容直接就位",
		String(skeletonSeen).startsWith("没看到骨架"),
		String(skeletonSeen),
	);
	check(
		"提交行和展开区的线条粗细一致，跨过边界不变样",
		(measured.widths?.length ?? 0) === 1,
		`粗细取值：${(measured.widths ?? []).join(" / ") || "没采到"}`,
	);
	check(
		"提交行和展开区的线条透明度一致，没有明暗接缝",
		(measured.opacities?.length ?? 0) === 1,
		`透明度取值：${(measured.opacities ?? []).join(" / ") || "没采到"}`,
	);

	const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, "history-expanded.png"), Buffer.from(shot.data, "base64"));
	process.stdout.write(`\n截图：${join(dir, "history-expanded.png")}\n`);
} finally {
	await app.stop();
}

process.exit(failures === 0 ? 0 : 1);
