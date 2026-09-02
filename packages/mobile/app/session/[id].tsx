import { useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useLayoutEffect, useRef, useState, type ComponentRef } from "react";
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AssistantMessage, Message } from "../../src/protocol";
import { assistantText, useMobile, type ToolRun } from "../../src/store";

export default function SessionScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const navigation = useNavigation();
	const insets = useSafeAreaInsets();

	const activeSession = useMobile((s) => s.activeSession);
	const sessions = useMobile((s) => s.sessions);
	const messages = useMobile((s) => s.messages);
	const toolRuns = useMobile((s) => s.toolRuns);
	const approvals = useMobile((s) => s.approvals);
	const running = useMobile((s) => s.running);
	const error = useMobile((s) => s.error);
	const openSession = useMobile((s) => s.openSession);
	const closeSession = useMobile((s) => s.closeSession);
	const send = useMobile((s) => s.send);
	const abort = useMobile((s) => s.abort);
	const approve = useMobile((s) => s.approve);

	const [draft, setDraft] = useState("");
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const setModel = useMobile((s) => s.setModel);
	const models = useMobile((s) => s.settings?.models ?? []);
	/*
	 * `ComponentRef`, not `ScrollView` itself.
	 *
	 * React Native 0.87 generates its types from Flow, and `ScrollView` became a function component
	 * there — so the class no longer doubles as its own instance type and `useRef<ScrollView>` says
	 * the ref holds the component, which has no `scrollToEnd` on it. `ComponentRef` asks the
	 * question that was always meant: whatever this component hands to a ref. That answer is right
	 * on either shape, so it does not need revisiting the next time the declaration moves.
	 */
	const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);

	// Deep-linking straight to a session id means the store may not have it loaded yet.
	useEffect(() => {
		if (activeSession?.id === id) return;
		const meta = sessions.find((s) => s.id === id);
		if (meta) void openSession(meta);
	}, [id, activeSession, sessions, openSession]);

	useEffect(() => () => closeSession(), [closeSession]);

	useLayoutEffect(() => {
		navigation.setOptions({ title: activeSession?.title ?? "会话" });
	}, [navigation, activeSession]);

	useEffect(() => {
		scrollRef.current?.scrollToEnd({ animated: true });
	}, [messages, toolRuns]);

	if (!activeSession) {
		return (
			<View className="flex-1 items-center justify-center bg-shell">
				<ActivityIndicator color="#9a9a9a" />
			</View>
		);
	}

	const approval = approvals[0];

	return (
		<KeyboardAvoidingView
			className="flex-1 bg-shell"
			behavior={Platform.OS === "ios" ? "padding" : undefined}
			keyboardVerticalOffset={insets.top + 44}
		>
			<ScrollView ref={scrollRef} className="flex-1" contentContainerStyle={{ padding: 14, paddingBottom: 24 }}>
				<View className="mb-3 flex-row items-center gap-2">
					<Text className="flex-1 text-[11.5px] text-ink-faint" numberOfLines={1}>
						{activeSession.cwd}
					</Text>
					{/*
					 * A label once the conversation has started.
					 *
					 * The model is settled by the first message — the history carries handles
					 * only that model can replay — so offering a picker here would be offering
					 * something the desktop is going to refuse.
					 */}
					{messages.length > 0 ? (
						<Text className="px-2 py-1 text-[11.5px] text-ink-faint">
							{models.find((m) => m.id === activeSession.modelId)?.name ?? activeSession.modelId}
						</Text>
					) : (
						<Pressable
							onPress={() => setModelPickerOpen(true)}
							className="rounded-lg border border-line px-2 py-1 active:bg-card-hover"
						>
							<Text className="text-[11.5px] text-ink-muted">
								{models.find((m) => m.id === activeSession.modelId)?.name ?? "选择模型"}
							</Text>
						</Pressable>
					)}
				</View>

				{modelPickerOpen && (
					<View className="mb-3 overflow-hidden rounded-xl border border-line bg-card/40">
						{models.map((model) => (
							<Pressable
								key={model.id}
								onPress={() => {
									void setModel(model.id);
									setModelPickerOpen(false);
								}}
								className="border-b border-line-soft px-3.5 py-2.5 last:border-b-0 active:bg-card-hover"
							>
								<Text className="text-[13px] text-ink">{model.name}</Text>
								<Text className="mt-0.5 text-[11px] text-ink-faint">{model.provider}</Text>
							</Pressable>
						))}
						{models.length === 0 && (
							<Text className="px-3.5 py-4 text-center text-[12px] text-ink-faint">桌面端还没有可用模型</Text>
						)}
					</View>
				)}

				{messages.map((message, index) => (
					<MessageRow key={rowKey(message, index)} message={message} toolRuns={toolRuns} />
				))}

				{running && (
					<View className="flex-row items-center gap-2 py-2">
						<ActivityIndicator size="small" color="#6e6e6e" />
						<Text className="text-[12px] text-ink-faint">Agent 正在工作…</Text>
					</View>
				)}

				{error && (
					<View className="mt-2 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5">
						<Text className="text-[12.5px] text-danger">{error}</Text>
					</View>
				)}
			</ScrollView>

			{approval && (
				<View className="border-t border-accent/40 bg-panel px-4 py-3">
					<Text className="text-[13.5px] font-medium text-ink">{approval.title}</Text>
					<ScrollView className="mt-2 max-h-28 rounded-lg bg-shell px-3 py-2">
						<Text className="font-mono text-[11.5px] leading-5 text-ink-muted">{approval.detail}</Text>
					</ScrollView>
					<View className="mt-3 flex-row gap-2">
						<Pressable
							onPress={() => void approve(approval.id, "reject")}
							className="flex-1 items-center rounded-lg border border-line py-2.5 active:bg-card-hover"
						>
							<Text className="text-[13px] text-ink-muted">拒绝</Text>
						</Pressable>
						<Pressable
							onPress={() => void approve(approval.id, "always")}
							className="flex-1 items-center rounded-lg border border-line py-2.5 active:bg-card-hover"
						>
							<Text className="text-[13px] text-ink-muted">始终允许</Text>
						</Pressable>
						<Pressable
							onPress={() => void approve(approval.id, "once")}
							className="flex-1 items-center rounded-lg bg-ink py-2.5 active:opacity-85"
						>
							<Text className="text-[13px] font-medium text-shell">允许</Text>
						</Pressable>
					</View>
				</View>
			)}

			<View className="border-t border-line bg-sidebar px-3 pt-2.5" style={{ paddingBottom: insets.bottom || 12 }}>
				<View className="flex-row items-end gap-2">
					<TextInput
						value={draft}
						onChangeText={setDraft}
						placeholder="随心输入"
						placeholderTextColor="#6e6e6e"
						multiline
						className="max-h-32 min-h-11 flex-1 rounded-2xl border border-line bg-input px-4 py-2.5 text-[14px] leading-5 text-ink"
					/>
					{running ? (
						<Pressable
							onPress={() => void abort()}
							className="h-11 w-11 items-center justify-center rounded-full bg-ink active:opacity-85"
						>
							<View className="h-3 w-3 rounded-[2px] bg-shell" />
						</Pressable>
					) : (
						<Pressable
							disabled={!draft.trim()}
							onPress={() => {
								void send(draft);
								setDraft("");
							}}
							className="h-11 w-11 items-center justify-center rounded-full bg-elevated active:opacity-85 disabled:opacity-40"
						>
							<Text className="text-[17px] leading-5 text-ink">↑</Text>
						</Pressable>
					)}
				</View>
			</View>
		</KeyboardAvoidingView>
	);
}

function rowKey(message: Message, index: number): string {
	if (message.role === "toolResult") return `tr-${message.toolCallId}`;
	return `${message.role}-${message.timestamp}-${index}`;
}

function MessageRow({ message, toolRuns }: { message: Message; toolRuns: Record<string, ToolRun> }) {
	if (message.role === "toolResult") return null;

	if (message.role === "user") {
		if (message.synthetic) return null;
		return (
			<View className="mb-3 items-end">
				{/*
				 * Dispatched from the desktop's side chat, not typed here.
				 *
				 * The side chat itself is a desktop thing — it lives in memory on that machine
				 * and never syncs. What does sync is the work it hands to the session, which
				 * arrives on the phone looking like a message you wrote and cannot remember
				 * writing. This label is the whole explanation.
				 */}
				{message.origin === "side-chat" && (
					<Text className="mr-1 mb-1 text-[11px] text-ink-faint">来自侧边聊天</Text>
				)}
				<View className="max-w-[85%] rounded-2xl rounded-br-md bg-card px-3.5 py-2.5">
					<Text className="text-[14px] leading-6 text-ink">
						{message.content.map((c) => (c.type === "text" ? c.text : "[图片]")).join("\n")}
					</Text>
				</View>
			</View>
		);
	}

	return <AssistantRow message={message} toolRuns={toolRuns} />;
}

function AssistantRow({ message, toolRuns }: { message: AssistantMessage; toolRuns: Record<string, ToolRun> }) {
	const text = assistantText(message);
	const thinking = message.content.find((c) => c.type === "thinking");
	const calls = message.content.filter((c) => c.type === "toolCall");

	return (
		<View className="mb-4">
			{thinking && thinking.type === "thinking" && thinking.thinking.length > 0 && (
				<ThinkingBlock text={thinking.thinking} />
			)}

			{calls.map((call) => call.type === "toolCall" && <ToolCard key={call.id} run={toolRuns[call.id]} name={call.name} />)}

			{text.length > 0 && <Text className="text-[14px] leading-6 text-ink">{stripMarkdown(text)}</Text>}

			{message.stopReason === "error" && message.errorMessage && (
				<View className="mt-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2">
					<Text className="text-[12.5px] text-danger">{message.errorMessage}</Text>
				</View>
			)}

			{message.stopReason !== "pending" && text.length > 0 && message.usage.total > 0 && (
				<Text className="mt-1.5 text-[11px] text-ink-faint">
					{message.usage.input.toLocaleString()} in · {message.usage.output.toLocaleString()} out
					{message.usage.cost.total > 0 ? ` · $${message.usage.cost.total.toFixed(4)}` : ""}
				</Text>
			)}
		</View>
	);
}

function ThinkingBlock({ text }: { text: string }) {
	const [open, setOpen] = useState(false);
	return (
		<View className="mb-2">
			<Pressable onPress={() => setOpen((v) => !v)}>
				<Text className="text-[12px] text-ink-faint">思考过程 {open ? "▾" : "▸"}</Text>
			</Pressable>
			{open && (
				<Text className="mt-1.5 border-l-2 border-line pl-3 text-[12.5px] leading-5 text-ink-muted">{text}</Text>
			)}
		</View>
	);
}

function ToolCard({ run, name }: { run: ToolRun | undefined; name: string }) {
	const [open, setOpen] = useState(false);
	const status = run?.status ?? "running";

	return (
		<Pressable
			onPress={() => setOpen((v) => !v)}
			className="mb-2 rounded-xl border border-line-soft bg-card/40 px-3 py-2.5"
		>
			<View className="flex-row items-center gap-2">
				<Text className="flex-1 text-[12.5px] text-ink-muted" numberOfLines={1}>
					{run?.summary ?? name}
				</Text>
				<Text
					className={`text-[11px] ${
						status === "error" ? "text-danger" : status === "done" ? "text-ok" : "text-ink-faint"
					}`}
				>
					{status === "running" ? "运行中" : status === "done" ? "完成" : "失败"}
				</Text>
			</View>
			{open && run?.output && (
				<Text className="mt-2 font-mono text-[11px] leading-4 text-ink-faint" numberOfLines={40}>
					{run.output}
				</Text>
			)}
		</Pressable>
	);
}

/**
 * React Native has no markdown renderer built in. Rather than ship a half-broken one, strip
 * the syntax that would otherwise show up as literal asterisks and backticks.
 */
function stripMarkdown(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*\n?/g, "").trimEnd())
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/^\s*[-*+]\s+/gm, "• ");
}
