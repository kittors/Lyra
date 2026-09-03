import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useMobile } from "../src/store";
import "../global.css";

export default function RootLayout() {
	const hydrate = useMobile((s) => s.hydrate);

	useEffect(() => {
		void hydrate();
	}, [hydrate]);

	return (
		<GestureHandlerRootView style={{ flex: 1, backgroundColor: "#171717" }}>
			<SafeAreaProvider>
				<StatusBar style="light" />
				<Stack
					screenOptions={{
						headerStyle: { backgroundColor: "#1c1c1c" },
						headerTintColor: "#ededed",
						headerTitleStyle: { fontSize: 16, fontWeight: "600" },
						headerShadowVisible: false,
						contentStyle: { backgroundColor: "#171717" },
					}}
				>
					<Stack.Screen name="index" options={{ title: "Lyra" }} />
					<Stack.Screen name="pair" options={{ title: "连接桌面端", presentation: "modal" }} />
					{/*
					 * Full screen, and no header: the viewfinder is the instruction, and a title bar
					 * over a camera reads as a form that happens to have a picture in it.
					 */}
					{/*
					 * The desktop's interface, full screen and chrome-free.
					 *
					 * No header: the page draws its own — the same top row the desktop has — and a
					 * native title bar above it would be the app announcing itself twice.
					 */}
					<Stack.Screen name="desk" options={{ headerShown: false }} />
					<Stack.Screen name="scan" options={{ title: "扫码连接", headerShown: false, presentation: "fullScreenModal" }} />
				</Stack>
			</SafeAreaProvider>
		</GestureHandlerRootView>
	);
}
