/**
 * Prints the PDF fixtures next to this file, using Electron's own `printToPDF`.
 *
 * The fixtures are committed rather than produced during the test run, because the run happens in
 * two places that cannot produce them:
 *
 *   - Linux CI has no display, so Electron does not start at all.
 *   - macOS CI has a display but no Chinese font. `printToPDF` still succeeds there and writes a
 *     valid PDF — with the Chinese set in tofu, which carries no text. The three fixtures that
 *     exist to test Chinese extraction came back empty and the assertions failed on content, not
 *     on a missing file, which is the more confusing of the two failures.
 *
 * So they are printed once, here, on a real desktop with real fonts, and read from disk by the
 * test. Same production line as the PDFs a person actually receives — just not the same minute.
 *
 * Re-run after changing what a fixture must contain:
 *
 *   node packages/desktop/test/fixtures/make-pdfs.mjs
 *
 * It needs a machine with a display and a CJK font installed; a headless run would quietly write
 * the same tofu that CI does.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A 1×1 transparent PNG, stretched over a page: an image with no text layer behind it. */
const BLANK_PNG =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/**
 * What each fixture is for. The names match the test that reads it.
 *
 * Keep the bodies small: these are read on every test run, and a fixture large enough to be worth
 * compressing is a fixture nobody will regenerate.
 */
const FIXTURES = {
	// Mixed scripts and enough body text to prove the page numbering is real.
	"mixed.pdf": `<h1>技术架构白皮书</h1><p>系统在生产环境的 P99 延迟为 320 毫秒。</p>
		 <p>English text is included to verify mixed-script extraction.</p>`,
	// The Kangxi radical problem: these words come out of the text layer on the wrong code points.
	"radicals.pdf": `<p>白皮书记载：第一章自下而上，生产环境可用区日均处理。</p>`,
	// Full-width punctuation, which a blanket NFKC would flatten into ASCII.
	"punctuation.pdf": `<p>第一项，第二项；第三项。</p>`,
	// A scan: one image filling the page, no text layer anywhere in it.
	"scan.pdf": `<img src="${BLANK_PNG}" style="width:600px;height:800px">`,
};

const dir = mkdtempSync(join(tmpdir(), "lyra-fixtures-"));
const script = join(dir, "print.cjs");
const jobs = Object.entries(FIXTURES).map(([name, body]) => ({ target: join(HERE, name), body }));

writeFileSync(
	script,
	`const { app, BrowserWindow } = require("electron");
	const { writeFileSync } = require("node:fs");
	const jobs = ${JSON.stringify(jobs)};
	app.on("ready", async () => {
		const win = new BrowserWindow({ show: false, width: 900, height: 1200 });
		for (const job of jobs) {
			const html = '<html><head><meta charset="utf-8"><style>body{font-family:"PingFang SC";padding:40px;line-height:1.8}</style></head><body>' + job.body + '</body></html>';
			await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
			writeFileSync(job.target, await win.webContents.printToPDF({ printBackground: true }));
		}
		app.quit();
	});`,
);

const electron = createRequire(import.meta.url)("electron");
execFileSync(electron, [script], { stdio: "inherit", timeout: 120_000 });
rmSync(dir, { recursive: true, force: true });

for (const job of jobs) console.log(`印好 ${job.target}`);
