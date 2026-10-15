/**
 * A code font stack that can draw Chinese on every platform.
 *
 * Monospace faces have no Han, so a Chinese comment in the editor or a Chinese line in the terminal
 * is drawn by whatever comes after them — and once the stack reaches the generic `monospace`,
 * Chromium on Windows answers Han with NSimSun, a hairline serif in the middle of code. The default
 * stack names YaHei before `monospace` for exactly that reason (see `tokens.css`), but every preset
 * in the font menu named only PingFang, which Windows does not have: choosing Consolas, JetBrains
 * Mono or any other turned the editor's and the terminal's Chinese into SimSun's sibling.
 *
 * So whatever stack is stored — a preset, the default, one typed by hand — the Han faces the
 * default names are put in front of `monospace` if it lacks them. A stack that already chose a
 * Chinese face keeps it ahead of these; nothing it lists is moved.
 */

/** The default stack's Han faces, in its order: Windows, then macOS, then Linux. */
const HAN_FACES = ['"Microsoft YaHei UI"', '"Microsoft YaHei"', '"PingFang SC"', '"Noto Sans CJK SC"'];

const family = (entry: string) => entry.trim().replace(/^["']|["']$/g, "").toLowerCase();

export function withHanFallback(stack: string): string {
	const entries = stack
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	const present = new Set(entries.map(family));
	const missing = HAN_FACES.filter((face) => !present.has(family(face)));
	if (missing.length === 0) return stack;
	// Ahead of the generic family, which would otherwise answer first.
	const generic = entries.findIndex((entry) => family(entry) === "monospace");
	const at = generic === -1 ? entries.length : generic;
	return [...entries.slice(0, at), ...missing, ...entries.slice(at)].join(", ");
}
