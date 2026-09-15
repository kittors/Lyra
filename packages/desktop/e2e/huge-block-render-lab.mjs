/* oxlint-disable no-console -- probe CLI */
/**
 * 造一张实验页，比三种画法画同一条 12 MB 消息要多久。
 *
 * 用户那条卡死的消息是一个 12.26 MB 的 text block，**一行**，一千三百万字符不带换行。问题分两段：
 * `parseInline` 是平方级的（每个 `[`、`*`、`` ` `` 都往后长距离找配对，找不到就白扫一趟），以及
 * 把这么一坨塞进一个 DOM 节点之后 Chromium 的换行计算。第二段光看代码判断不了，所以这里不猜，
 * 直接把三种画法摆到真浏览器里各画一遍：
 *
 *   A  原样——一个 <p> 装下全部（今天就是这样）
 *   B  切成小块，每块一个 <p>
 *   C  切成小块，且每块 content-visibility:auto——屏幕外的浏览器自己跳过布局
 *
 * 要是 C 能把首次绘制压到一帧附近，那条路就是通的：内容一个字不少地留在 DOM 里，可以随便上下滚、
 * 可以搜可以复制，不用折叠也不用聚合。
 *
 * 用法：node e2e/huge-block-render-lab.mjs   然后用浏览器打开它打印的那个路径
 */

import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "/Users/kittors/.lyra/sessions/638c1d5fcb97d249/2723f0cb-add6-415f-aa94-dff71d02aa7b.jsonl";

/** 取出这个会话里最大的那个 text block——也就是真正交给 Markdown 的那段。 */
function hugestTextBlock(file) {
	let big = "";
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (!line) continue;
		let record;
		try {
			record = JSON.parse(line);
		} catch {
			continue;
		}
		const content = record.message?.content;
		if (typeof content === "string") {
			if (content.length > big.length) big = content;
			continue;
		}
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (block.type === "text" && typeof block.text === "string" && block.text.length > big.length) big = block.text;
		}
	}
	return big;
}

const text = hugestTextBlock(SOURCE);
console.log(`取到 ${(text.length / 1024 / 1024).toFixed(2)} MB，${text.split("\n").length} 行`);

const page = `<!doctype html>
<meta charset="utf-8">
<title>huge block render lab</title>
<style>
  body { font: 13px/1.6 ui-monospace, monospace; margin: 0; padding: 12px; }
  #out { position: sticky; top: 0; background: #fff; border-bottom: 2px solid #333; padding: 8px 0; white-space: pre; }
  #host p { margin: 0; overflow-wrap: anywhere; }
  .chunked p { content-visibility: auto; contain-intrinsic-size: auto 400px; }
</style>
<div id="out">准备中…</div>
<div id="host"></div>
<script id="payload" type="text/plain">PAYLOAD</script>
<script>
const text = document.getElementById("payload").textContent;
const host = document.getElementById("host");
const out = document.getElementById("out");
const log = (line) => { out.textContent += "\\n" + line; };

/** 画一次，量到「布局真的算完」为止——读 offsetHeight 会逼浏览器当场把布局做掉。 */
function paint(label, build) {
  host.className = "";
  host.textContent = "";
  void host.offsetHeight;
  const t0 = performance.now();
  build();
  const h = host.offsetHeight;
  const dt = performance.now() - t0;
  log(label.padEnd(34) + String(Math.round(dt)).padStart(7) + " ms   高 " + h.toLocaleString() + "px");
  return dt;
}

/** 按字符切块；只在这条消息上用，它本来就是一行没有断点的数据。 */
function chunks(size) {
  const parts = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}

window.RUN = () => {
  out.textContent = "这条消息 " + (text.length / 1024 / 1024).toFixed(2) + " MB，" + text.split("\\n").length + " 行";
  const result = {};
  result.whole = paint("A 原样：一个 <p> 装全部", () => {
    const p = document.createElement("p");
    p.textContent = text;
    host.append(p);
  });
  const parts = chunks(50000);
  result.chunked = paint("B 切 " + parts.length + " 块，每块一个 <p>", () => {
    const frag = document.createDocumentFragment();
    for (const part of parts) {
      const p = document.createElement("p");
      p.textContent = part;
      frag.append(p);
    }
    host.append(frag);
  });
  result.contained = paint("C 切块 + content-visibility", () => {
    host.className = "chunked";
    const frag = document.createDocumentFragment();
    for (const part of parts) {
      const p = document.createElement("p");
      p.textContent = part;
      frag.append(p);
    }
    host.append(frag);
  });
  return result;
};
</script>
`;

const html = page.replace("PAYLOAD", text.replace(/&/g, "&amp;").replace(/</g, "&lt;"));
writeFileSync("/tmp/huge-block-lab.html", html);
console.log(`实验页写到 /tmp/huge-block-lab.html（${(html.length / 1024 / 1024).toFixed(1)} MB）`);
