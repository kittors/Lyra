/**
 * Serving the pages the agent writes.
 *
 * Previews live outside the workspace and are reached over two custom schemes rather than `file://`:
 * `ly-media` for a project's own files, `ly-preview` for generated pages. Both exist so that every
 * read goes through one door with one check — a page asking for `../../../.ssh/id_rsa` gets a 403
 * instead of a key.
 */

import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { lyraHome, previewsHome } from "@lyra/core";
import { net, protocol, session } from "electron";

export const MEDIA_SCHEME = "ly-media";
export const PREVIEW_SCHEME = "ly-preview";

/**
 * The theme the very first painted frame should already be wearing.
 *
 * The renderer cannot work this out in time: the stylesheet ships one palette, and the real one
 * only arrives after `settings:get` resolves — several frames in. So a light-theme app opened
 * dark and then snapped, every launch. The main process has the settings on disk before the
 * window exists, so it hands the answer to the preload, which paints it before the first frame.
 */
/**
 * Tell the OS which appearance this window is in.
 *
 * The platform draws its own surfaces — menus, dialogs, scrollbars, the traffic lights — and picks
 * their appearance from the *window's*, which left alone is whatever the system is set to. A light
 * app on a dark system got dark native chrome around a light page. Nothing in CSS can reach that
 * layer; the window has to be told.
 */
/** Enough of a MIME table for a self-contained page; anything else is served as bytes. */
/**
 * Let a preview say how tall it wants to be.
 *
 * The card cannot ask: the page is on its own origin inside a sandbox with no same-origin, so
 * nothing in the app can read its layout. The page can volunteer the number, though, and
 * `postMessage` crosses that boundary in the one safe direction — a bare integer, going out.
 *
 * Injected rather than required of the agent, because a page that had to remember to include
 * this would sometimes forget, and the sizing would be right only some of the time.
 */
function withHeightReporter(html: string): string {
	/*
	 * Two ways to measure, because either one alone is wrong half the time.
	 *
	 * If the document already scrolls, the content has outgrown the viewport and `scrollHeight` is
	 * exactly the answer. If it does not, the page has been asked how tall it is while filling the
	 * space it was given — `height: 100vh`, a centred grid, a flex column — and it will keep
	 * answering with that space no matter what space we offer.
	 *
	 * For that second case the height rules are lifted and the content is left to compose itself.
	 * That measurement has its own blind spot, which is why it is not used for everything: a page
	 * whose inner boxes are sized in percentages collapses without a height to be a percentage of,
	 * and reports far less than it draws. Restored in the same task, so nothing is ever painted in
	 * the measured state.
	 */
	/*
	 * A classic feedback loop, cut at the source.
	 *
	 * Measure the content, size the card to it, and a page that lands a pixel over its allowance
	 * grows a scrollbar. The scrollbar takes width from the content, the content rewraps and gets
	 * taller, and now it really does overflow — the bar earns its own existence, and every preview
	 * ends up with a grey rail down one side that nothing asked for.
	 *
	 * Removing it from the layout ends the loop: an overlay scrollbar takes no width, so measuring
	 * and displaying agree.
	 *
	 * Hiding the rail was not enough on its own, though. A page left a pixel over its allowance
	 * still scrolls — it wobbles under the wheel, and worse, it swallows the gesture, so scrolling
	 * with the pointer over a preview stops moving the conversation behind it. Inside the card the
	 * page therefore does not scroll at all: it was measured to fit, and anything that genuinely
	 * needs more room has the side panel, where scrolling is what you came for. `ly-inline` is set
	 * by the card and by nothing else, so the same file scrolls normally when opened there.
	 */
	const style = `<style>html.ly-inline,html.ly-inline body{overflow:hidden!important}html{scrollbar-width:none}html::-webkit-scrollbar,body::-webkit-scrollbar{width:0;height:0;display:none}</style>`;
	const script = `<script>(function(){
/* Set before first paint, so the page is never briefly scrollable. */
if(location.hash==="#ly-inline"&&document.documentElement)document.documentElement.className+=" ly-inline";
var last=0;
function measure(){
var b=document.body,d=document.documentElement;
if(!b||!d)return 0;
var scroll=Math.max(b.scrollHeight,d.scrollHeight);
if(scroll>d.clientHeight+2)return scroll;
var keep=[[b,b.style.height,b.style.minHeight],[d,d.style.height,d.style.minHeight]];
b.style.height="auto";b.style.minHeight="0";
d.style.height="auto";d.style.minHeight="0";
var natural=Math.max(b.scrollHeight,b.offsetHeight);
for(var i=0;i<keep.length;i++){keep[i][0].style.height=keep[i][1];keep[i][0].style.minHeight=keep[i][2];}
return natural;
}
function report(){
/* A pixel of slack. Sub-pixel layout rounds up as often as down, and with overflow hidden the
   difference is not a scrollbar any more — it is a clipped row of text. */
var h=measure();if(h)h+=2;
if(h&&Math.abs(h-last)>2){last=h;try{parent.postMessage({__dwPreviewHeight:h},"*")}catch(e){}}
}
addEventListener("load",report);addEventListener("resize",report);
if(window.ResizeObserver&&document.documentElement)new ResizeObserver(report).observe(document.documentElement);
setTimeout(report,50);setTimeout(report,200);setTimeout(report,500);setTimeout(report,1200);
})();</script>`;
	// Before the page's own scripts, so a page that never finishes loading still reports.
	const head = html.match(/<head[^>]*>/i);
	if (head) return html.replace(head[0], `${head[0]}${style}${script}`);
	return style + script + html;
}

function contentTypeFor(path: string): string {
	const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
	return (
		{
			".html": "text/html; charset=utf-8",
			".css": "text/css; charset=utf-8",
			".js": "text/javascript; charset=utf-8",
			".json": "application/json; charset=utf-8",
			".svg": "image/svg+xml",
			".png": "image/png",
			".jpg": "image/jpeg",
			".jpeg": "image/jpeg",
			".gif": "image/gif",
			".webp": "image/webp",
			".avif": "image/avif",
			".bmp": "image/bmp",
			".ico": "image/x-icon",
			/*
			 * The types below are what let a file be *rendered* rather than downloaded.
			 *
			 * Chromium picks its PDF viewer from the content type and nothing else — served as
			 * `application/octet-stream`, an `<embed>` shows a grey box and offers to save the file.
			 * The media types matter for the same reason: `<video>` will not start a stream it has
			 * been told is a byte array, so a `.mkv` played and a `.mov` did not, depending entirely
			 * on how much of the file Chromium was willing to sniff.
			 */
			".pdf": "application/pdf",
			".mp4": "video/mp4",
			".m4v": "video/mp4",
			".webm": "video/webm",
			".mov": "video/quicktime",
			".mkv": "video/x-matroska",
			".mp3": "audio/mpeg",
			".wav": "audio/wav",
			".flac": "audio/flac",
			".ogg": "audio/ogg",
			".m4a": "audio/mp4",
			".aac": "audio/aac",
			".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		}[ext] ?? "application/octet-stream"
	);
}

/**
 * Register both schemes, on the default session and on the browser panel's partition.
 *
 * `protocol.handle` only ever registers against the session it is called on, and the panel's
 * `<webview>` runs in a partition of its own — which is the point, since a page the agent wrote
 * should not share cookies with anything. The cost is that the partition starts out not knowing the
 * scheme exists, so "open in the side panel" landed on a blank page until it was told.
 */
export function registerPreviewProtocols(options: {
	browserPartition: string;
	resolveMedia(target: string): Promise<string | null>;
}): void {
	const { browserPartition, resolveMedia } = options;

	/*
	 * `ly-media://f/<encoded absolute path>`. Decoding it here is the only place it becomes a path
	 * again — and the only place it is checked.
	 *
	 * The check resolves both sides first, which is why it is `resolveReadablePath` rather than the
	 * plain string comparison this used to do. A directory listing hands the renderer canonical
	 * paths, so on macOS an image under a temporary or symlinked project came back as
	 * `/private/var/…` while the configured project path was still `/var/…` — the same directory,
	 * spelled two ways, and the guard read that as "outside the project" and answered 403. Every
	 * picture in a markdown file rendered as its alt text.
	 *
	 * Resolving is also the stricter reading: a symlink inside a project that points out of it
	 * stops being a way through.
	 */
	protocol.handle(MEDIA_SCHEME, async (request) => {
		const target = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ""));
		const allowed = target ? await resolveMedia(target) : null;
		if (!allowed) return new Response("forbidden", { status: 403 });
		return net.fetch(pathToFileURL(allowed).toString(), { headers: request.headers, method: request.method });
	});

	// `ly-preview://<sessionId>/<previewId>/<file>`, resolved against the previews directory.
	const servePreview = async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		const root = previewsHome(lyraHome());
		const target = resolve(root, url.hostname, decodeURIComponent(url.pathname).replace(/^\//, ""));
		if (target !== root && !target.startsWith(root + sep)) return new Response("forbidden", { status: 403 });
		const body = await readFile(target).catch(() => null);
		if (!body) return new Response("not found", { status: 404 });
		const type = contentTypeFor(target);
		const payload = type.startsWith("text/html") ? withHeightReporter(body.toString("utf8")) : body;
		return new Response(payload, { headers: { "content-type": type } });
	};

	protocol.handle(PREVIEW_SCHEME, servePreview);
	session.fromPartition(browserPartition).protocol.handle(PREVIEW_SCHEME, servePreview);
}
