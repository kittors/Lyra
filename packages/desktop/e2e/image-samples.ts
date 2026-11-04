/**
 * A fixed set of large pictures for measuring what images cost a request.
 *
 * Ten 4K screenshots of the kinds of screens people actually paste — code, a document, a sheet, a
 * dashboard, a terminal, a chat, devtools, a design, a page with a photo in it, a diff — rendered by
 * Electron itself at a device scale of 2, so they are real 3840×2160 PNGs with real text in them. The
 * code and prose are this repository's own files, so the text has the density of the real thing.
 *
 * Three phone-sized photos (4032×3024) come from the system wallpapers through `sips`: two JPEGs and
 * one HEIC, the format an iPhone hands over. macOS only, which is where these probes run.
 *
 * Deterministic: the same files every run, so a before and an after measure the same bytes.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

export interface ImageSample {
	path: string;
	name: string;
	mime: string;
	kind: "screenshot" | "photo";
}

const REPO = join(import.meta.dirname, "..", "..", "..");

function source(path: string, lines: number): string {
	return readFileSync(join(REPO, path), "utf8").split("\n").slice(0, lines).join("\n");
}

/** Every page builds itself from this script, so the HTML handed to Electron stays short. */
const PAGE_SCRIPT = String.raw`
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (list) => list[Math.floor(rand() * list.length)];
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const KW = /\b(import|export|from|const|let|function|return|if|else|for|while|await|async|interface|type|new|class|extends)\b/g;
function codeLines(text, n) {
	return text.split("\n").slice(0, n).map((line, i) =>
		'<div><span style="color:#5c6370;display:inline-block;width:48px;text-align:right;margin-right:18px">' + (i + 1) + '</span>' +
		esc(line).replace(KW, '<span style="color:#c678dd">$1</span>').replace(/("[^"]*"|\x60[^\x60]*\x60)/g, '<span style="color:#98c379">$1</span>').replace(/(\/\/.*|\/\*.*|\s\*.*)$/, '<span style="color:#7f848e;font-style:italic">$1</span>') + '</div>').join("");
}
function photoCanvas(w, h) {
	const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
	const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, "#7fb2e5"); sky.addColorStop(0.55, "#f4d6a0"); sky.addColorStop(1, "#3f5f2a");
	g.fillStyle = sky; g.fillRect(0, 0, w, h);
	for (let i = 0; i < 2600; i++) { g.fillStyle = "hsla(" + (80 + rand() * 60) + ",40%," + (20 + rand() * 40) + "%,0.35)"; g.beginPath(); g.arc(rand() * w, h * 0.55 + rand() * h * 0.45, 2 + rand() * 18, 0, 7); g.fill(); }
	const px = g.getImageData(0, 0, w, h); for (let i = 0; i < px.data.length; i += 4) { const n = (rand() - 0.5) * 26; px.data[i] += n; px.data[i + 1] += n; px.data[i + 2] += n; } g.putImageData(px, 0, 0);
	return c;
}
`;

function page(body: string, style = ""): string {
	return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:1920px;height:1080px;overflow:hidden;font-family:-apple-system,'PingFang SC',sans-serif}${style}</style></head><body>${body}<script>${PAGE_SCRIPT}</script></body></html>`;
}

function screens(): { name: string; html: string }[] {
	const loop = source("packages/core/src/agent/loop.ts", 140);
	const read = source("packages/desktop/src/features/composer/attachments/read.ts", 140);
	const agents = source("AGENTS.md", 120);
	return [
		{
			name: "01-code-dark",
			html: page(
				`<div style="display:flex;height:100%;background:#21252b;color:#abb2bf"><div id="tree" style="width:300px;padding:14px;font-size:13px;line-height:24px;color:#9da5b4"></div><pre id="code" style="flex:1;margin:0;padding:16px;background:#282c34;font:13px/20px Menlo,monospace;overflow:hidden"></pre></div><script>setTimeout(()=>{document.getElementById("code").innerHTML=codeLines(${JSON.stringify(loop)},52);document.getElementById("tree").innerHTML=Array.from({length:40},(_, i)=>'<div style="padding-left:'+(i%4)*14+'px">'+pick(["src","agent","loop.ts","runner.ts","tools","read.ts","bash.ts","images","budget.ts","types"])+'</div>').join("")})</script>`,
			),
		},
		{
			name: "02-doc-light",
			html: page(
				`<article id="doc" style="width:1100px;margin:40px auto;font-size:17px;line-height:30px;color:#1f2328"></article><script>setTimeout(()=>{document.getElementById("doc").innerHTML=${JSON.stringify(agents)}.split("\\n").filter(Boolean).slice(0,46).map(l=>l.startsWith("#")?'<h2 style="margin:18px 0 6px">'+esc(l.replace(/^#+ /,""))+'</h2>':'<p style="margin:0 0 8px">'+esc(l)+'</p>').join("")})</script>`,
			),
		},
		{
			name: "03-sheet",
			html: page(
				`<table id="t" style="border-collapse:collapse;font:13px/22px -apple-system;color:#222"></table><script>setTimeout(()=>{let h="";for(let r=0;r<48;r++){h+="<tr>";for(let c=0;c<22;c++){const v=r===0?"列"+(c+1):c===0?"行 "+r:(rand()*100000).toFixed(c%3?2:0);h+='<td style="border:1px solid #d0d7de;padding:0 8px;min-width:70px;background:'+(r===0||c===0?"#f6f8fa":r%7===3?"#fff8c5":"#fff")+'">'+v+"</td>"}h+="</tr>"}document.getElementById("t").innerHTML=h})</script>`,
			),
		},
		{
			name: "04-dashboard",
			html: page(
				`<div id="d" style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:32px;background:#f3f5f9;height:100%;box-sizing:border-box"></div><script>setTimeout(()=>{let h="";for(let i=0;i<6;i++){let bars="";for(let b=0;b<24;b++){const v=20+rand()*200;bars+='<rect x="'+(b*22)+'" y="'+(240-v)+'" width="16" height="'+v+'" rx="3" fill="hsl('+(200+i*25)+',70%,55%)"/>'}h+='<div style="background:#fff;border-radius:16px;box-shadow:0 4px 18px rgba(0,0,0,.08);padding:20px"><div style="font-size:15px;color:#667">指标 '+(i+1)+' · 本周</div><div style="font-size:38px;font-weight:600;margin:6px 0 12px">'+(rand()*10000).toFixed(1)+'</div><svg width="530" height="240">'+bars+'</svg></div>'}document.getElementById("d").innerHTML=h})</script>`,
			),
		},
		{
			name: "05-terminal",
			html: page(
				`<pre id="t" style="margin:0;height:100%;padding:18px;background:#0d1117;color:#c9d1d9;font:14px/21px Menlo,monospace"></pre><script>setTimeout(()=>{const lv=[["INFO","#3fb950"],["WARN","#d29922"],["ERROR","#f85149"],["DEBUG","#8b949e"]];let h="";for(let i=0;i<50;i++){const [l,c]=pick(lv);h+='<span style="color:#8b949e">2026-11-04 23:'+String(10+i%50).padStart(2,"0")+':'+String(Math.floor(rand()*60)).padStart(2,"0")+'</span> <span style="color:'+c+'">'+l+'</span> '+pick(["request sent","stream opened","tool bash finished in 812ms","retry after 2s: 529 overloaded","compaction kept 41 of 120 messages","image resized 3840x2160 -> 1568x882","cache hit 98.2%"])+' <span style="color:#58a6ff">session='+Math.floor(rand()*1e8).toString(16)+'</span>\\n'}document.getElementById("t").innerHTML=h})</script>`,
			),
		},
		{
			name: "06-chat",
			html: page(
				`<div id="c" style="width:1000px;margin:0 auto;padding:24px;display:flex;flex-direction:column;gap:14px"></div><script>setTimeout(()=>{const lines=${JSON.stringify(agents)}.split("\\n").filter(l=>l.length>20);let h="";for(let i=0;i<14;i++){const me=i%2===0;h+='<div style="align-self:'+(me?"flex-end":"flex-start")+';max-width:720px;padding:12px 16px;border-radius:18px;font-size:16px;line-height:26px;background:'+(me?"#0b84ff":"#e9e9eb")+';color:'+(me?"#fff":"#111")+'">'+esc(lines[(i*7)%lines.length])+'</div>'}document.getElementById("c").innerHTML=h})</script>`,
			),
		},
		{
			name: "07-devtools",
			html: page(
				`<div style="display:flex;height:100%;font:11px/17px Menlo,monospace;color:#303942"><pre id="src" style="flex:1;margin:0;padding:8px;border-right:1px solid #ccc;overflow:hidden"></pre><table id="net" style="flex:1;border-collapse:collapse"></table></div><script>setTimeout(()=>{document.getElementById("src").innerHTML=codeLines(${JSON.stringify(read)},60);let h="";for(let i=0;i<60;i++){h+='<tr style="background:'+(i%2?"#f5f5f5":"#fff")+'"><td style="padding:0 6px">'+pick(["messages","models","upload","session","stream"])+"?id="+Math.floor(rand()*1e6)+'</td><td>'+pick([200,200,200,413,429,500])+'</td><td>'+pick(["fetch","xhr","script"])+'</td><td>'+(rand()*900).toFixed(1)+' kB</td><td>'+(rand()*4000).toFixed(0)+' ms</td></tr>'}document.getElementById("net").innerHTML=h})</script>`,
			),
		},
		{
			name: "08-design",
			html: page(
				`<div id="g" style="display:grid;grid-template-columns:repeat(4,1fr);gap:28px;padding:40px;height:100%;box-sizing:border-box;background:linear-gradient(135deg,#fdfbfb,#ebedee)"></div><script>setTimeout(()=>{let h="";for(let i=0;i<8;i++){const a=Math.floor(rand()*360);h+='<div style="border-radius:28px;box-shadow:0 20px 40px rgba(0,0,0,.15);background:linear-gradient('+(a)+'deg,hsl('+a+',80%,60%),hsl('+(a+60)+',80%,45%));display:flex;align-items:flex-end;padding:24px;color:#fff;font-size:26px;font-weight:600">卡片 '+(i+1)+'</div>'}document.getElementById("g").innerHTML=h})</script>`,
			),
		},
		{
			name: "09-web-photo",
			html: page(
				`<header style="height:64px;display:flex;align-items:center;padding:0 40px;font-size:20px;font-weight:600;border-bottom:1px solid #eee">旅行日志</header><div style="display:flex;gap:32px;padding:32px 40px"><div id="ph" style="width:1200px;height:880px;border-radius:12px;overflow:hidden"></div><div id="tx" style="flex:1;font-size:16px;line-height:28px;color:#333"></div></div><script>setTimeout(()=>{document.getElementById("ph").appendChild(photoCanvas(2400,1760)).style.width="1200px";document.getElementById("tx").innerHTML=${JSON.stringify(agents)}.split("\\n").filter(l=>l.length>30).slice(0,22).map(l=>"<p>"+esc(l)+"</p>").join("")})</script>`,
			),
		},
		{
			name: "10-diff",
			html: page(
				`<pre id="d" style="margin:0;height:100%;padding:12px;background:#fff;font:13px/20px Menlo,monospace"></pre><script>setTimeout(()=>{const src=${JSON.stringify(loop)}.split("\\n");let h="";for(let i=0;i<52;i++){const t=rand();const bg=t<0.18?"#ffebe9":t<0.36?"#dafbe1":"#fff";const sign=t<0.18?"-":t<0.36?"+":" ";h+='<div style="background:'+bg+'">'+sign+" "+esc(src[(i*2)%src.length])+"</div>"}document.getElementById("d").innerHTML=h})</script>`,
			),
		},
	];
}

/** Render (once) and return the fixed set. Existing files are reused, so a rerun measures the same bytes. */
export function makeImageSamples(dir: string): ImageSample[] {
	mkdirSync(dir, { recursive: true });
	const pages = screens();
	const missing = pages.filter((p) => !existsSync(join(dir, `${p.name}.png`)));
	if (missing.length > 0) {
		const script = join(dir, "make-screens.cjs");
		writeFileSync(
			script,
			`const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const PAGES = ${JSON.stringify(missing)};
const DIR = ${JSON.stringify(dir)};
app.commandLine.appendSwitch("force-device-scale-factor", "2");
app.on("ready", async () => {
	const win = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true, enableLargerThanScreen: true });
	for (const p of PAGES) {
		await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(p.html));
		await new Promise((r) => setTimeout(r, 600));
		const image = await win.webContents.capturePage();
		writeFileSync(join(DIR, p.name + ".png"), image.toPNG());
	}
	app.quit();
});`,
		);
		const electron = createRequire(import.meta.url)("electron") as unknown as string;
		execFileSync(electron, [script], { stdio: "ignore", timeout: 180_000 });
	}

	const photos = [
		{ name: "11-photo-sonoma.jpg", from: "/System/Library/Desktop Pictures/Sonoma.heic", format: "jpeg" },
		{ name: "12-photo-horizon.jpg", from: "/System/Library/Desktop Pictures/.wallpapers/Sonoma Horizon/Sonoma Horizon.heic", format: "jpeg" },
		{ name: "13-photo-iphone.heic", from: "/System/Library/Desktop Pictures/.wallpapers/Sonoma Horizon/Sonoma Horizon.heic", format: "heic" },
	];
	for (const photo of photos) {
		const out = join(dir, photo.name);
		if (existsSync(out)) continue;
		const tmp = `${out}.tiff`;
		// Fill 4032×3024 (a 12 MP phone frame) and crop the middle, so no sample is stretched.
		execFileSync("sips", ["-s", "format", "tiff", "--resampleHeight", "3024", photo.from, "--out", tmp], { stdio: "ignore" });
		execFileSync("sips", ["--cropToHeightWidth", "3024", "4032", tmp], { stdio: "ignore" });
		execFileSync("sips", ["-s", "format", photo.format, "-s", "formatOptions", photo.format === "jpeg" ? "92" : "high", tmp, "--out", out], { stdio: "ignore" });
		execFileSync("rm", ["-f", tmp]);
	}

	return [
		...pages.map((p) => ({ path: join(dir, `${p.name}.png`), name: `${p.name}.png`, mime: "image/png", kind: "screenshot" as const })),
		...photos.map((p) => ({ path: join(dir, p.name), name: p.name, mime: p.format === "heic" ? "image/heic" : "image/jpeg", kind: "photo" as const })),
	];
}
