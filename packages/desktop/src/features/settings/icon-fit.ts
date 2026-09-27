/**
 * How a loaded icon should sit in its square.
 *
 * Most icons are tiles: they paint their whole square, rounded corners aside, and bring their own
 * background, so whatever is drawn behind them is hidden. Some are a glyph on transparency instead —
 * Superpowers ships a black mark with nothing behind it — and those take on whatever the page is. On
 * the dark theme that black mark all but vanishes, and a mark that is not square (Cloudflare's cloud
 * is 66×30) is cropped by an `object-cover` fit.
 *
 * So the picture is measured once, after it loads. The middle of each edge tells a tile from a glyph:
 * a rounded square still fills it, a glyph with any margin around it does not. For a glyph, the
 * brightness of what is drawn picks the plate it sits on — light behind a dark mark, dark behind a
 * light one — so it reads the same on either theme.
 *
 * The market's web page makes the same call the same way (`lib/icon-fit.ts` in Lyra-Registry); the
 * two show the same icons side by side in people's heads, and should agree about them.
 *
 * `tile` is also the answer whenever the picture cannot be read — no canvas (the test DOM), or a
 * canvas the picture taints — and drawing it exactly as before is the safe way to be wrong.
 */

export type IconFit = "tile" | "light" | "dark";

const SIZE = 32;
const known = new Map<string, IconFit>();

export function iconFit(img: HTMLImageElement): IconFit {
	const key = img.currentSrc || img.src;
	const cached = known.get(key);
	if (cached) return cached;
	const fit = measure(img);
	known.set(key, fit);
	return fit;
}

function measure(img: HTMLImageElement): IconFit {
	if (!img.naturalWidth || !img.naturalHeight) return "tile";
	const canvas = document.createElement("canvas");
	canvas.width = SIZE;
	canvas.height = SIZE;
	let pixels: Uint8ClampedArray;
	try {
		const context = canvas.getContext("2d", { willReadFrequently: true });
		if (!context) return "tile";
		// Drawn the way `contain` draws it, so a wide mark leaves the same empty bands the row would.
		const scale = Math.min(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
		const width = img.naturalWidth * scale;
		const height = img.naturalHeight * scale;
		context.drawImage(img, (SIZE - width) / 2, (SIZE - height) / 2, width, height);
		pixels = context.getImageData(0, 0, SIZE, SIZE).data;
	} catch {
		return "tile";
	}

	const alpha = (x: number, y: number) => pixels[(y * SIZE + x) * 4 + 3] ?? 0;
	const middle = SIZE / 2;
	const edges = [alpha(middle, 1), alpha(1, middle), alpha(SIZE - 2, middle), alpha(middle, SIZE - 2)];
	if (edges.every((value) => value > 200)) return "tile";

	let total = 0;
	let counted = 0;
	for (let index = 0; index < pixels.length; index += 4) {
		if ((pixels[index + 3] ?? 0) < 128) continue;
		const red = pixels[index] ?? 0;
		const green = pixels[index + 1] ?? 0;
		const blue = pixels[index + 2] ?? 0;
		total += (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
		counted += 1;
	}
	// A near-white mark needs the dark plate; anything else reads on the light one.
	return counted > 0 && total / counted > 0.72 ? "dark" : "light";
}
