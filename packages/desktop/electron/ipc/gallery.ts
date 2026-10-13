/**
 * The gallery, over IPC: every picture `image_generate` drew, in every conversation.
 *
 * One reader per store, so what it has already read survives between openings of the gallery — a
 * conversation is read again only after it has been written to.
 */

import { ipcMain } from "electron";
import { GalleryReader, type SessionStorage } from "@lyra/core";

export interface GalleryIpcDeps {
	store(): SessionStorage;
}

export function registerGalleryIpc({ store }: GalleryIpcDeps): void {
	const readers = new WeakMap<SessionStorage, GalleryReader>();
	ipcMain.handle("gallery:list", () => {
		const current = store();
		let reader = readers.get(current);
		if (!reader) readers.set(current, (reader = new GalleryReader(current)));
		return reader.list();
	});
}
