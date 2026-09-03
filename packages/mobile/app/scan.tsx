import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SyncClient } from "../src/client";
import { parsePairingCode } from "../src/pairing";
import { useMobile } from "../src/store";

/**
 * Point the camera at the desktop, and be connected.
 *
 * The whole screen is the viewfinder because that is the instruction — anything else here would be
 * something to read before doing the obvious thing. What it adds to the picture is a frame to aim
 * at and one line of state, and the state is the part that matters: a scan that has been read but
 * not yet verified looks identical to one that has not been read at all, and holding a phone at a
 * screen wondering whether it worked is the failure this replaces.
 *
 * Verification happens here rather than after: a code can be scanned perfectly and still name a
 * desktop this phone cannot reach — wrong network, service stopped, the address that belonged to a
 * VPN. Finding that out on this screen means the camera is still up and the next attempt is a
 * movement of the wrist.
 */
export default function ScanScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const pair = useMobile((s) => s.pair);

	const [permission, requestPermission] = useCameraPermissions();
	/*
	 * A square that fits the narrow side, capped so it does not swallow a tablet's screen.
	 *
	 * Measured rather than declared: the frame is only useful if it is square, and the corners
	 * are positioned against this box.
	 */
	const { width } = useWindowDimensions();
	const frame = Math.min(280, width - 80);
	const [state, setState] = useState<{ kind: "idle" | "checking" | "error"; text?: string }>({ kind: "idle" });
	/*
	 * One scan at a time.
	 *
	 * The camera fires this callback per frame it decodes, which is many times a second while the
	 * code is in view — so without a latch the first successful read starts a dozen pairings.
	 * A ref rather than state: it has to be true for the very next frame, not after a render.
	 */
	const busy = useRef(false);

	const onScan = useCallback(
		async ({ data }: { data: string }) => {
			if (busy.current) return;
			busy.current = true;

			const parsed = parsePairingCode(data);
			if (!parsed.ok) {
				setState({ kind: "error", text: parsed.reason });
				// Long enough to read, short enough that a retry does not feel blocked.
				setTimeout(() => {
					busy.current = false;
					setState({ kind: "idle" });
				}, 1600);
				return;
			}

			setState({ kind: "checking", text: "正在连接…" });
			const { host, port, tls } = parsed.connection;
			if (!(await SyncClient.ping(host, port, tls))) {
				setState({ kind: "error", text: `连不上 ${host}:${port}，检查两台设备是否在同一网络` });
				setTimeout(() => {
					busy.current = false;
					setState({ kind: "idle" });
				}, 2600);
				return;
			}

			if (!(await pair(parsed.connection))) {
				setState({ kind: "error", text: "令牌被拒绝，请在桌面端重新生成二维码" });
				setTimeout(() => {
					busy.current = false;
					setState({ kind: "idle" });
				}, 2600);
				return;
			}

			router.replace("/desk");
		},
		[pair, router],
	);

	if (!permission) {
		return (
			<View className="flex-1 items-center justify-center bg-shell">
				<ActivityIndicator color="#9a9a9a" />
			</View>
		);
	}

	if (!permission.granted) {
		return (
			<View className="flex-1 items-center justify-center bg-shell px-8" style={{ paddingBottom: insets.bottom }}>
				<Text className="text-center text-[15px] font-medium text-ink">需要相机权限</Text>
				<Text className="mt-2 text-center text-[13px] leading-6 text-ink-muted">
					扫描桌面端「移动端同步」页面上的二维码，就能一步完成配对。相机只用于这一件事。
				</Text>
				<Pressable
					onPress={() => {
						/*
						 * Asking again only works the first time.
						 *
						 * Once the OS has recorded a denial it answers instantly without showing
						 * anything, so a button that keeps calling `requestPermission` looks broken.
						 * After that the only way through is Settings, and saying so is more useful
						 * than a button that silently does nothing.
						 */
						if (permission.canAskAgain) void requestPermission();
						else void Linking.openSettings();
					}}
					className="mt-6 rounded-xl bg-ink px-5 py-3 active:opacity-85"
				>
					<Text className="text-[14px] font-medium text-shell">
						{permission.canAskAgain ? "允许使用相机" : "去系统设置里开启"}
					</Text>
				</Pressable>
				<Pressable onPress={() => router.replace("/pair")} className="mt-3 px-5 py-2.5 active:opacity-70">
					<Text className="text-[13px] text-ink-muted">改用手动输入</Text>
				</Pressable>
			</View>
		);
	}

	return (
		<View className="flex-1 bg-black">
			<CameraView
				style={{ flex: 1 }}
				facing="back"
				// Only QR: the desktop never emits anything else, and every other format a camera can
				// read here is something that is not this app's to act on.
				barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
				onBarcodeScanned={state.kind === "checking" ? undefined : (event) => void onScan(event)}
			>
				<View className="flex-1 items-center justify-center px-10">
					{/*
					 * A square to aim at, drawn as four corners.
					 *
					 * A full rectangle reads as a boundary the code must fit inside, which makes
					 * people back away until the code is too small to decode. Corners read as
					 * "around here", which is all the scanner actually needs.
					 */}
					{/*
					 * Sized in style rather than with `aspect-square` and `max-w-[…]`.
					 *
					 * Those two produced a frame taller than it was wide on the device — the corners
					 * are absolutely positioned against this box, so whatever it measures is what the
					 * frame looks like, and a rectangle around a square code reads as a misalignment
					 * you are supposed to correct by moving the phone.
					 */}
					<View style={{ width: frame, height: frame }}>
						<Corner className="left-0 top-0 border-l-[3px] border-t-[3px] rounded-tl-2xl" />
						<Corner className="right-0 top-0 border-r-[3px] border-t-[3px] rounded-tr-2xl" />
						<Corner className="bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-2xl" />
						<Corner className="bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-2xl" />
					</View>

					<View className="mt-8 h-16 items-center justify-center">
						{state.kind === "checking" ? (
							<View className="flex-row items-center gap-2.5">
								<ActivityIndicator size="small" color="#ededed" />
								<Text className="text-[14px] text-white">{state.text}</Text>
							</View>
						) : state.kind === "error" ? (
							<View className="rounded-xl bg-danger/90 px-4 py-2.5">
								<Text className="text-center text-[13px] leading-5 text-white">{state.text}</Text>
							</View>
						) : (
							<Text className="text-center text-[14px] leading-6 text-white/85">
								对准桌面端的二维码{"\n"}
								<Text className="text-[12.5px] text-white/60">设置 → 移动端同步</Text>
							</Text>
						)}
					</View>
				</View>

				<View className="px-8" style={{ paddingBottom: insets.bottom + 20 }}>
					<Pressable
						onPress={() => router.replace("/pair")}
						className="items-center rounded-xl border border-white/25 py-3 active:bg-white/10"
					>
						<Text className="text-[14px] text-white">扫不了？手动输入地址</Text>
					</Pressable>
				</View>
			</CameraView>
		</View>
	);
}

/** One corner of the aiming frame. Positioned absolutely by the classes it is given. */
function Corner({ className }: { className: string }) {
	return <View className={`absolute h-9 w-9 border-white/85 ${className}`} />;
}
