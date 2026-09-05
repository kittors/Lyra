/** Labels describe the local keyboard, including when a phone talks to a different OS. */
export function macKeyboard(platform = navigator.platform): boolean {
	return /Mac|iPhone|iPad|iPod|darwin/i.test(platform);
}

/** Existing UI copy uses compact Mac notation; other keyboards need named modifiers. */
export function shortcutLabel(text: string, platform = navigator.platform): string {
	if (macKeyboard(platform)) return text;
	return text.replace(/([⌘⌃⌥⇧]+)(\S?)/g, (_match: string, modifiers: string, key: string) => {
		const parts: string[] = [];
		if (/[⌘⌃]/.test(modifiers)) parts.push("Ctrl");
		if (modifiers.includes("⌥")) parts.push("Alt");
		if (modifiers.includes("⇧")) parts.push("Shift");
		if (key) parts.push(key === "⌫" ? "Backspace" : key);
		return parts.join("+");
	});
}

/** Render Electron accelerators without confusing Control, Command and the Windows key. */
export function acceleratorLabel(accelerator: string, platform = navigator.platform): string {
	const mac = macKeyboard(platform);
	const names: Record<string, string> = {
		commandorcontrol: mac ? "⌘" : "Ctrl", cmdorctrl: mac ? "⌘" : "Ctrl",
		command: mac ? "⌘" : "Win", cmd: mac ? "⌘" : "Win", meta: mac ? "⌘" : "Win",
		super: mac ? "⌘" : "Win", control: mac ? "⌃" : "Ctrl", ctrl: mac ? "⌃" : "Ctrl",
		alt: mac ? "⌥" : "Alt", option: mac ? "⌥" : "Alt", shift: mac ? "⇧" : "Shift",
	};
	return accelerator.split("+").map((part) => names[part.toLowerCase()] ?? part).join(mac ? " " : "+");
}

/** The IME and AltGr own these keys; treating them as commands changes panes while typing. */
export function composingKey(event: KeyboardEvent): boolean {
	return event.isComposing || event.keyCode === 229 || event.getModifierState("AltGraph");
}

export function recordAccelerator(event: KeyboardEvent, platform = navigator.platform): string | null {
	if (composingKey(event) || ["Control", "Shift", "Alt", "Meta"].includes(event.key)) return null;
	const mac = macKeyboard(platform);
	const parts: string[] = [];
	if (event.metaKey) parts.push(mac ? "CommandOrControl" : "Super");
	if (event.ctrlKey) parts.push(mac ? "Control" : "CommandOrControl");
	if (event.altKey) parts.push("Alt");
	if (event.shiftKey) parts.push("Shift");
	// Option changes `key` (S becomes ß); Electron accelerators name the physical letter.
	let key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3)
		: /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : event.key;
	const names: Record<string, string> = {
		" ": "Space", "+": "Plus", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
	};
	key = names[key] ?? key.toUpperCase();
	return [...parts, key].join("+");
}
