/**
 * Reading what a window actually painted: a CDP screenshot as raw pixels, sampled in CSS px.
 *
 * Kept apart from any one probe because "what colour is it there" is the question every visual check
 * ends on, and reading it back from the pixels — not from `getComputedStyle` — is what catches a style
 * that is right on paper and wrong on screen.
 */

import { spawnSync } from "node:child_process";

export type RGB = [number, number, number];
export interface Picture {
	width: number;
	height: number;
	/** Image pixels per CSS px. */
	k: number;
	origin: { x: number; y: number };
	rgb: Buffer;
}

/**
 * Chromium's PNG as raw RGB, through ffmpeg — the same tool that encodes the film.
 *
 * Always the whole window at its own device pixels: a `clip` with a `scale` re-renders the page under
 * a temporary emulation, and the hover it is meant to photograph is gone by the next capture.
 */
export function decode(png: Buffer, cssWidth: number): Picture {
	const width = png.readUInt32BE(16);
	const height = png.readUInt32BE(20);
	const out = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { input: png, maxBuffer: 1 << 28 });
	if (out.status !== 0) throw new Error(`ffmpeg 解不开截图：${out.stderr.toString()}`);
	return { width, height, k: width / cssWidth, origin: { x: 0, y: 0 }, rgb: out.stdout };
}

/** A region of a window capture, blown up with whole pixels so every device pixel stays visible. */
export function enlarge(png: Buffer, pic: Picture, box: { x: number; y: number; width: number; height: number }, file: string): void {
	const [x, y, w, h] = [box.x, box.y, box.width, box.height].map((v) => Math.round(v * pic.k));
	const zoom = Math.round(16 / pic.k);
	const out = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", "pipe:0", "-vf", `crop=${w}:${h}:${x}:${y},scale=iw*${zoom}:ih*${zoom}:flags=neighbor`, file], { input: png });
	if (out.status !== 0) throw new Error(`ffmpeg 放大失败：${out.stderr.toString()}`);
}

/** Mean colour of a small disc around a page point (CSS px). */
export function sample(pic: Picture, x: number, y: number, radius = 0.4): RGB {
	const cx = (x - pic.origin.x) * pic.k;
	const cy = (y - pic.origin.y) * pic.k;
	const r = Math.max(0.75, radius * pic.k);
	const sum = [0, 0, 0];
	let n = 0;
	for (let py = Math.floor(cy - r); py <= Math.ceil(cy + r); py++) {
		for (let px = Math.floor(cx - r); px <= Math.ceil(cx + r); px++) {
			if ((px + 0.5 - cx) ** 2 + (py + 0.5 - cy) ** 2 > r * r || px < 0 || py < 0 || px >= pic.width || py >= pic.height) continue;
			const i = (py * pic.width + px) * 3;
			sum[0] += pic.rgb[i];
			sum[1] += pic.rgb[i + 1];
			sum[2] += pic.rgb[i + 2];
			n++;
		}
	}
	return sum.map((v) => v / n) as RGB;
}

export const distance = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const mean = (a: RGB, b: RGB): RGB => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
export const hex = (c: RGB) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
