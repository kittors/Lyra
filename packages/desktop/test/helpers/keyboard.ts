/**
 * Pretend the keyboard belongs to another system for the length of one block.
 *
 * happy-dom reports `navigator.platform` as "X11; Darwin arm64", which `macKeyboard()` reads as a
 * Mac — so every label and binding under test is the macOS one unless a test says otherwise.
 * The real property is a getter on the prototype: shadowing it on the instance and deleting the
 * shadow afterwards puts the original back without having to know what it was, even when the
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
