/**
 * Pretend the keyboard belongs to another system for the length of one block.
 *
 * The DOM shim pins `navigator.platform` to a Mac (`helpers/dom.ts`) — happy-dom would otherwise
 * report the host's — so every label and binding under test is the macOS one unless a test says
 * otherwise. The pinned value is a getter on the prototype: shadowing it on the instance and
 * deleting the shadow afterwards puts it back without having to know what it was, even when the
 * block throws.
 */
export async function withKeyboard(platform: string, run: () => unknown): Promise<void> {
	Object.defineProperty(navigator, "platform", { value: platform, configurable: true });
	try {
		await run();
	} finally {
		Reflect.deleteProperty(navigator, "platform");
	}
}
