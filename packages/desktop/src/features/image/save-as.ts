/**
 * 另存为, for a picture shown anywhere in the app.
 *
 * An anchor with `download` is the whole of it: Electron turns the navigation into a download and,
 * with no save path set, asks where to put it. A `data:` URL is already the file; a media-scheme
 * picture gets a readable name from the main process (`media-downloads.ts`).
 */
export function saveImageAs(src: string): void {
	const link = document.createElement("a");
	link.href = src;
	link.download = `image-${Date.now()}.png`;
	link.click();
}
