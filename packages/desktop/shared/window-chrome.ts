/** Native window chrome and renderer headers must use the same vertical geometry. */
export const WINDOW_HEADER_HEIGHT = 44;

// Electron's macOS traffic lights measure 14pt, including their outline. Treating them as
// 12pt put their centre one point below every renderer icon (verified with native captures).
export const MAC_TRAFFIC_LIGHT_POSITION = { x: 16, y: (WINDOW_HEADER_HEIGHT - 14) / 2 };
