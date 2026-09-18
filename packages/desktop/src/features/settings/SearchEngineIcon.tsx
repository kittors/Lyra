import { Search } from "lucide-react";
import { useId } from "react";

import type { BrowserSearchEngine } from "../../../shared/browser.ts";

/**
 * Official colour marks for the address-bar search engines.
 *
 * Same rule as `ModelIcon`: the path is the vendor's, not a tracing. An approximation of
 * somebody's logo is worse than no logo. `custom` is not a brand, so it stays a Lucide mark.
 */

const SIZE = 16;

export function SearchEngineIcon({
	engine,
	size = SIZE,
}: {
	engine: BrowserSearchEngine;
	size?: number;
}) {
	const gradientId = useId();
	if (engine === "custom") {
		return <Search size={size} strokeWidth={1.9} className="shrink-0 text-ink-muted" aria-hidden />;
	}
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className="shrink-0"
			data-search-engine={engine}
			aria-hidden
		>
			{engine === "google" ? <GoogleMark /> : engine === "bing" ? <BingMark gradientId={gradientId} /> : engine === "baidu" ? <BaiduMark /> : <DuckMark />}
		</svg>
	);
}

/** https://developers.google.com/identity/branding-guidelines — the four-colour G. */
function GoogleMark() {
	return (
		<>
			<path
				fill="#4285F4"
				d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
			/>
			<path
				fill="#34A853"
				d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
			/>
			<path
				fill="#FBBC05"
				d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
			/>
			<path
				fill="#EA4335"
				d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
			/>
		</>
	);
}

/** https://www.bing.com/favicon.ico — Microsoft's 2020 Fluent b. */
function BingMark({ gradientId }: { gradientId: string }) {
	return (
		<>
			<defs>
				<linearGradient id={gradientId} x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
					<stop stopColor="#0087D4" />
					<stop offset="0.55" stopColor="#1DB0A6" />
					<stop offset="1" stopColor="#8CD600" />
				</linearGradient>
			</defs>
			<path
				fill={`url(#${gradientId})`}
				d="M7.15 2.2c0-.66.54-1.2 1.2-1.2h2.05c.66 0 1.2.54 1.2 1.2v7.35c1.05-.85 2.45-1.35 4.05-1.35 3.85 0 6.35 2.7 6.35 6.4 0 3.7-2.5 6.4-6.35 6.4-1.85 0-3.45-.7-4.5-1.95v1.15c0 .66-.54 1.2-1.2 1.2H8.35c-.66 0-1.2-.54-1.2-1.2V2.2Zm4.45 13.55c0 2.05 1.45 3.4 3.4 3.4s3.35-1.35 3.35-3.4-1.4-3.4-3.35-3.4-3.4 1.35-3.4 3.4Z"
			/>
		</>
	);
}

/** https://www.baidu.com/favicon.ico — the blue paw. */
function BaiduMark() {
	return (
		<>
			<circle cx="5.55" cy="6.85" r="2.2" fill="#2932E1" />
			<circle cx="12" cy="4.5" r="2.35" fill="#2932E1" />
			<circle cx="18.45" cy="6.85" r="2.2" fill="#2932E1" />
			<path
				fill="#2932E1"
				d="M12 9.45c5.15 0 8.7 3.2 8.7 7.15 0 3.25-2.75 5.9-8.7 5.9s-8.7-2.65-8.7-5.9c0-3.95 3.55-7.15 8.7-7.15Z"
			/>
			<path
				fill="#fff"
				d="M8.35 13.2h7.3v1.2h-2.55v.95h2.2v1.1h-2.2v2.85c.9 0 1.65-.35 2.2-.85l.9.95c-.8.75-1.85 1.2-3.2 1.25v-4.2H8.35v-1.1h2.55v-.95H8.35V13.2Z"
			/>
		</>
	);
}

/** https://duckduckgo.com/assets/icons/meta/DDG-icon_256x256.png — official duck. */
function DuckMark() {
	return (
		<>
			<circle cx="12" cy="12" r="12" fill="#DE5833" />
			<path
				fill="#fff"
				d="M8.85 15.85c-.15-2.55 1.35-6.15 5.05-7.15 1.05-.3 2.2-.15 2.95.45.1-.65.05-1.25-.1-1.6.4.15.95.75 1.1 1.6.55.3 1 .8 1.2 1.4.35.1.55.5.4.9-.15.5-.65.85-1.2 1-.2 2.25-1.75 4.55-4.55 4.55-2.25 0-3.5-1.35-3.7-2.75-.05-.4.2-.7.55-.7.45 0 .7.35.85.8.3.8.9 1.3 1.85 1.3 1.5 0 2.45-1.35 2.45-3.2 0-1.7-.95-2.95-2.4-2.95-1.5 0-2.4 1.15-2.4 2.75 0 .35-.25.6-.55.6-.45 0-.75-.35-.75-1.2Z"
			/>
			<path fill="#F5A623" d="M16.55 10.85c1.45.2 2.55.75 2.65 1.3.1.4-.5.75-1.6.85h-1.2c.05-.75.1-1.45.15-2.15Z" />
			<circle cx="13.2" cy="10.2" r="0.55" fill="#2B2B2B" />
			<circle cx="16.05" cy="10.05" r="0.55" fill="#2B2B2B" />
			<path fill="#5A9F3A" d="M11.55 15.2c.35-.35.9-.35 1.25 0l.5.5c.2.2.15.5-.15.55h-1.95c-.3 0-.4-.3-.2-.55l.55-.5Z" />
		</>
	);
}
