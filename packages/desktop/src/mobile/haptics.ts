/**
 * A tap you can feel, asked of the phone the page is running in.
 *
 * The WebView cannot reach the Taptic Engine — `navigator.vibrate` is a buzz on Android and does not
 * exist on iOS — so the page names what happened and the native shell plays it (`desk.tsx`, which
 * maps these names onto expo-haptics). The names are events rather than engine settings: the page
 * knows a long press landed, the shell knows what that should feel like on this device.
 *
 * Silent everywhere else. A desktop window has no `ReactNativeWebView`, and a phone build too old to
 * know the message ignores it rather than failing.
 */

export type HapticStyle = "selection" | "light" | "medium" | "heavy" | "rigid" | "success" | "warning" | "error";

interface NativeHost {
	ReactNativeWebView?: { postMessage(data: string): void };
	window?: NativeHost;
}

export function haptic(style: HapticStyle): void {
	// Both spellings, as `services/host.ts` reads the bridge: the same object in a page, not in a test.
	const scope = globalThis as NativeHost;
	const native = scope.ReactNativeWebView ?? scope.window?.ReactNativeWebView;
	// oxlint-disable-next-line unicorn/require-post-message-target-origin -- the native bridge's one-argument channel, not window.postMessage
	native?.postMessage(JSON.stringify({ type: "haptic", style }));
}
