import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Keyboard, Platform, Pressable, Text, ToastAndroid, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { StatusBar } from "expo-status-bar";
import { backPress, type BackState } from "../src/back";
import { bridgeScript } from "../src/bridge";
import { keyboardOverlap, type ScreenFrame } from "../src/keyboard";
import { useMobile } from "../src/store";

/**
 * The desktop's own interface, on the phone.
 *
 * Not a copy of it — the actual build, loaded from the machine this phone is paired with, so the
 * two are the same by construction rather than by discipline. What this file adds is the three
 * things a WebView cannot work out for itself: where to load from, what `window.lyra` is, and how
 * to sit inside a phone's chrome.
 *
 * The safe area is handled here rather than in the page. The renderer's layout already knows how
 * to be narrow (it goes there whenever a desktop window is dragged in), and it has no notion of a
 * notch or a home indicator — those are the phone's, so they are padding around the WebView
 * instead of a media query inside it.
 */
export default function DeskScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const connection = useMobile((s) => s.connection);

	const [loading, setLoading] = useState(true);
	const [failed, setFailed] = useState<string | null>(null);
	/*
	 * The page's theme, mirrored so the phone's own chrome can match it.
	 *
	 * Everything outside the WebView is painted here — the status bar, and the strips behind the
	 * notch and the home indicator. The page can be switched to a light theme from the desktop, and
	 * nothing would otherwise tell this side: white status text over a white page, in a dark frame.
	 *
	 * Starts dark because that is what the app declares, so there is no flash on the way in.
	 */
	const [theme, setTheme] = useState<{ dark: boolean; shell: string }>({ dark: true, shell: "#171717" });
	/*
	 * `WebView<object>`, not `WebView`.
	 *
	 * The library declares `class WebView<P = undefined> extends Component<WebViewProps & P>`, and
	 * `WebViewProps & undefined` collapses to `never` under strict mode — so the bare form accepts
	 * no props at all. Naming the parameter restores the intersection. A library-side bug, worked
	 * around rather than patched.
	 */
	const webview = useRef<WebView<object>>(null);
	const webviewHost = useRef<View>(null);
	const keyboardFrame = useRef<ScreenFrame | null>(null);
	const [nativeKeyboardInset, setNativeKeyboardInset] = useState(0);

	/*
	 * Android edge-to-edge windows do not consistently pass IME resizing through a WebView. Measure
	 * the real screen overlap here: adjustResize produces zero, while an overlaid keyboard shortens
	 * the WebView without guessing a device- or keyboard-specific height.
	 */
	const measureKeyboardOverlap = useCallback(() => {
		const keyboard = keyboardFrame.current;
		if (!keyboard) {
			setNativeKeyboardInset(0);
			return;
		}
		webviewHost.current?.measureInWindow((x, y, width, height) => {
			if (keyboardFrame.current !== keyboard) return;
			setNativeKeyboardInset(keyboardOverlap({ x, y, width, height }, keyboard));
		});
	}, []);

	useEffect(() => {
		if (Platform.OS !== "android") return;
		const shown = Keyboard.addListener("keyboardDidShow", ({ endCoordinates }) => {
			keyboardFrame.current = {
				x: endCoordinates.screenX,
				y: endCoordinates.screenY,
				width: endCoordinates.width,
				height: endCoordinates.height,
			};
			requestAnimationFrame(measureKeyboardOverlap);
		});
		const hidden = Keyboard.addListener("keyboardDidHide", () => {
			keyboardFrame.current = null;
			setNativeKeyboardInset(0);
		});
		return () => {
			shown.remove();
			hidden.remove();
		};
	}, [measureKeyboardOverlap]);

	const reload = useCallback(() => {
		setFailed(null);
		setLoading(true);
		webview.current?.reload();
	}, []);

	/*
	 * Android's back button.
	 *
	 * `BackHandler` wants an answer synchronously — it cannot wait for a round trip into the WebView
	 * — so the page reports how many layers it has open and this keeps a mirror of that number. A
	 * ref rather than state: it is read inside the handler and never drawn, and re-rendering the
	 * WebView every time a drawer opens would be a reload.
	 */
	const back = useRef<BackState>({ depth: 0 });

	useEffect(() => {
		if (Platform.OS !== "android") return;
		const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
			const action = backPress(back.current, Date.now());
			if (action.do === "close") {
				webview.current?.injectJavaScript("window.__lyraBack && window.__lyraBack(); true;");
				return true;
			}
			if (action.do === "warn") {
				back.current = action.state;
				ToastAndroid.show("再按一次退出", ToastAndroid.SHORT);
				return true;
			}
			return false;
		});
		return () => subscription.remove();
	}, []);

	if (!connection) {
		return (
			<View className="flex-1 items-center justify-center bg-shell px-8" style={{ paddingTop: insets.top }}>
				<Text className="text-center text-[15px] text-ink">还没有连接桌面端</Text>
				<Pressable onPress={() => router.replace("/pair")} className="mt-5 rounded-xl bg-ink px-5 py-3 active:opacity-85">
					<Text className="text-[14px] font-medium text-shell">去配对</Text>
				</Pressable>
			</View>
		);
	}

	const scheme = connection.tls ? "https" : "http";
	const origin = `${scheme}://${connection.host}:${connection.port}`;

	/*
	 * A relay carries frames, and the interface is not frames.
	 *
	 * The desktop hosts its own renderer over HTTP — a 4MB entry chunk and fifty-odd more it loads
	 * on demand — and a relay joins two WebSockets and copies bytes between them. There is nowhere
	 * for those requests to go. The data path works through one (calls, events, the transcript);
	 * the page itself has to come from somewhere the phone can actually reach.
	 *
	 * Said plainly rather than left as the 404 the WebView would otherwise show, which names the
	 * relay's address and reads as the desktop being broken.
	 */
	if (connection.relay) {
		return (
			<View
				className="flex-1 items-center justify-center bg-shell px-8"
				style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
			>
				<StatusBar style="light" />
				<Text className="text-center text-[15px] font-medium text-ink">中转只负责转发数据</Text>
				<Text className="mt-3 text-center text-[13px] leading-6 text-ink-muted">
					桌面端的界面要从它本机加载，而中转转发的是消息，不是网页。请在与电脑同一网络时配对，或在桌面端的「移动端同步」里填一个手机能直接访问的公网地址。
				</Text>
				<Text className="mt-2 text-center text-[12px] text-ink-faint">{origin}</Text>
				<Pressable
					onPress={() => router.replace("/pair")}
					className="mt-6 rounded-xl bg-ink px-5 py-3 active:opacity-85"
				>
					<Text className="text-[14px] font-medium text-shell">换一种方式连接</Text>
				</Pressable>
			</View>
		);
	}

	return (
		<View
			ref={webviewHost}
			className="flex-1"
			onLayout={measureKeyboardOverlap}
			// The page's own background, so the safe areas read as part of it rather than as a frame
			// around it. `bg-shell` was right for exactly one of the two themes.
			style={{
				backgroundColor: theme.shell,
				paddingTop: insets.top,
				paddingBottom: Math.max(insets.bottom, nativeKeyboardInset),
			}}
		>
			<StatusBar style={theme.dark ? "light" : "dark"} />
			<WebView<object>
				ref={webview}
				source={{ uri: `${origin}/app` }}
				/*
				 * Injected before the page's own scripts, because the very first thing the app does
				 * is read `window.lyra`. `injectedJavaScript` — without the suffix — runs after
				 * load, which is far too late: the renderer would already have crashed looking for
				 * an interface that was not there yet.
				 */
				injectedJavaScriptBeforeContentLoaded={bridgeScript(connection)}
				/*
				 * What the page tells us about itself: how many layers it has open, for the back
				 * button, and which theme it is in, for the status bar and the safe areas.
				 *
				 * Anything else is from a newer bridge than this build knows and is ignored
				 * rather than thrown — an unrecognised message is not a reason to take down a
				 * socket handler.
				 */
				onMessage={({ nativeEvent }) => {
					let message: { type?: string; depth?: number; dark?: boolean; shell?: string };
					try {
						message = JSON.parse(nativeEvent.data) as typeof message;
					} catch {
						return;
					}
					if (message.type === "layers" && typeof message.depth === "number") {
						back.current = { ...back.current, depth: message.depth };
					}
					if (message.type === "theme" && typeof message.dark === "boolean") {
						setTheme({ dark: message.dark, shell: message.shell || (message.dark ? "#171717" : "#ffffff") });
					}
				}}
				onLoadEnd={() => setLoading(false)}
				onError={({ nativeEvent }) => {
					setLoading(false);
					setFailed(nativeEvent.description || "打不开桌面端");
				}}
				onHttpError={({ nativeEvent }) => {
					setLoading(false);
					setFailed(`桌面端返回 ${nativeEvent.statusCode}`);
				}}
				/*
				 * Belt and braces against the focus zoom.
				 *
				 * The page it loads already asks for `maximum-scale=1`, but iOS has honoured that
				 * inconsistently across versions — and when it does zoom, the damage outlives the
				 * keyboard: the viewport stays wide and the send button stays off-screen. These two
				 * settle it at the WebView rather than relying on the page being obeyed.
				 */
				scalesPageToFit={false}
				setBuiltInZoomControls={false}
				// The renderer manages its own scrolling regions; a bouncing page underneath them
				// makes the whole interface feel detached from the phone.
				bounces={false}
				overScrollMode="never"
				// Native layout handles Android IME overlap; the page still covers visualViewport cases.
				automaticallyAdjustContentInsets={false}
				contentInsetAdjustmentBehavior="never"
				// The app is one origin; anything else is a link someone tapped, and belongs in a
				// browser rather than inside the session view.
				originWhitelist={[origin]}
				onShouldStartLoadWithRequest={(request) => request.url.startsWith(origin)}
				// Text selection and long-press callouts read as a web page rather than an app.
				{...(Platform.OS === "ios" ? { allowsLinkPreview: false } : {})}
				style={{ backgroundColor: "transparent" }}
			/>

			{loading && (
				<View className="absolute inset-0 items-center justify-center" style={{ backgroundColor: theme.shell }}>
					<ActivityIndicator color="#9a9a9a" />
					<Text className="mt-3 text-[12.5px] text-ink-faint">正在加载桌面端界面…</Text>
				</View>
			)}

			{failed && (
				<View className="absolute inset-0 items-center justify-center bg-shell px-8">
					<Text className="text-center text-[15px] font-medium text-ink">连不上桌面端</Text>
					<Text className="mt-2 text-center text-[13px] leading-6 text-ink-muted">{failed}</Text>
					<Text className="mt-1 text-center text-[12px] text-ink-faint">
						{origin}
					</Text>
					<View className="mt-6 flex-row gap-3">
						<Pressable onPress={reload} className="rounded-xl bg-ink px-5 py-3 active:opacity-85">
							<Text className="text-[14px] font-medium text-shell">重试</Text>
						</Pressable>
						<Pressable
							onPress={() => router.replace("/pair")}
							className="rounded-xl border border-line px-5 py-3 active:bg-card-hover"
						>
							<Text className="text-[14px] text-ink-muted">重新配对</Text>
						</Pressable>
					</View>
				</View>
			)}
		</View>
	);
}
