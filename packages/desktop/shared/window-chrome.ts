/**
 * 窗口顶上那条带子有多高——两个数，因为两边量的是不同的东西。
 *
 * 一度只有一个 44，四处共用：macOS 红绿灯的居中、dock 里每个面板的标题栏、Windows/Linux 那条
 * header，以及**传给系统去画最小化/最大化/关闭的高度**。最后一条是关键——那三颗按钮的大小是我们
 * 自己告诉系统的，而 44 的出处是 macOS 的红绿灯。于是 Windows 上的按钮比同屏任何一个原生窗口的
 * 都大一圈，那条带子也跟着空出十几个像素。
 *
 * 分开之后各自有了依据，谁也不再替谁定尺寸。
 */

/**
 * macOS 的红绿灯，以及 dock 里每个面板的标题栏。
 *
 * 44 是按红绿灯定的：14pt 的灯要在这条带子里居中（见下面的 `MAC_TRAFFIC_LIGHT_POSITION`）。
 * dock 的面板标题栏跟着它，是因为在 macOS 上第一行面板的标题就**是**窗口的顶行，两者必须同高
 * 才对得齐——那条规矩写在 `app/window/titlebar.ts` 的 `hasHeaderBar` 上。
 */
export const WINDOW_HEADER_HEIGHT = 44;

/**
 * Windows 与 Linux 那条 header，以及系统画的那三颗按钮。
 *
 * 32 是 Windows 标准标题栏按钮的高度，所以这个数同时管两件事：带子有多高，和
 * `titleBarOverlay.height` 传出去多少（见 `electron/window.ts`）。两者必须是同一个数——带子比
 * 按钮矮，按钮会探出带子；带子比按钮高，按钮上下各浮一段空白。
 *
 * 这里没有红绿灯要居中，所以 44 在这一侧从来没有依据。
 */
export const NATIVE_HEADER_HEIGHT = 32;

// Electron's macOS traffic lights measure 14pt, including their outline. Treating them as
// 12pt put their centre one point below every renderer icon (verified with native captures).
export const MAC_TRAFFIC_LIGHT_POSITION = { x: 16, y: (WINDOW_HEADER_HEIGHT - 14) / 2 };
