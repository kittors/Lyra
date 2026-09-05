/**
 * Which of the five 代码外观 settings the terminal follows.
 *
 * Font, size and weight: yes. A face chosen for the editor should be the face in the shell beside
 * it, and 「用于文件预览、代码编辑器与终端的等宽字体」 is what the setting promises.
 *
 * Line height and tracking: no. Those are reading settings — a fenced block in prose sits at 1.6
 * so the eye can track along a line, and someone who has pushed it to 2.3 and the tracking to
 * 0.09em for their eyes has, without meaning to, made every terminal cell 28px tall with a pixel
 * of air after each glyph. That is what a prompt with three lines of nothing between its lines
 * was, and the block cursor the size of a stamp: one cell, at that height. A terminal is a grid,
 * every terminal on the machine draws its grid at about 1.2 with no extra tracking, and the
 * programs that draw boxes and progress bars in it are designed for exactly that.
 */

/** Where terminals sit: enough for descenders and box-drawing to join, no more. */
export const TERMINAL_LINE_HEIGHT = 1.2;

export interface CodeTypography {
	codeFont?: string;
	codeFontSize?: number;
	codeFontWeight?: number;
	codeLineHeight?: number;
	codeLetterSpacing?: number;
}

export interface TerminalTypography {
	fontFamily: string;
	fontSize: number;
	fontWeight: number;
	lineHeight: number;
	letterSpacing: number;
}

export function terminalTypography(
	appearance: CodeTypography | undefined,
	fallback: { font: string; size: number; weight: number },
): TerminalTypography {
	return {
		fontFamily: appearance?.codeFont || fallback.font,
		fontSize: appearance?.codeFontSize ?? fallback.size,
		fontWeight: appearance?.codeFontWeight ?? fallback.weight,
		lineHeight: TERMINAL_LINE_HEIGHT,
		letterSpacing: 0,
	};
}
