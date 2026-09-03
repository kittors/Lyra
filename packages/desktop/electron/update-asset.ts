/**
 * Which file in a release this machine can actually install.
 *
 * Split out of `ipc/updates.ts` so it can be checked against a real release's file names without
 * an Electron process — which is how the bug it now guards against was found. A release carries
 * eleven files and only one of them is right for the machine asking; picking by extension alone
 * gets nine of them wrong on some machine or other.
 */

import { CHECKSUM_ASSET } from "./update-checksum.ts";

export interface ReleaseAsset {
	name?: string;
	browser_download_url?: string;
	size?: number;
}

export interface PickedAsset {
	name: string;
	url: string;
	size: number;
}

/**
 * How each platform's packaging spells an architecture in a file name.
 *
 * Three names for the same 64-bit Intel machine, because three build systems chose differently:
 * electron-builder writes `x64` for macOS and Windows, the AppImage convention is `x86_64`, and
 * Debian says `amd64`. All three appear in one Lyra release.
 */
const ARCH_TAGS: Record<string, string[]> = {
	arm64: ["arm64", "aarch64"],
	x64: ["x64", "x86_64", "amd64"],
};

/**
 * The one file this machine can install, or null.
 *
 * macOS takes the zip, not the disk image. A .dmg can only be *opened* — the user mounts it and
 * drags the app across, which is a manual install wearing the clothes of an automatic one. The zip
 * contains `Lyra.app` directly, so it can be unpacked and swapped in place. The dmg stays in the
 * release for people installing by hand the first time.
 *
 * Windows takes the setup executable, Linux the AppImage.
 *
 * **Architecture is checked on every platform, and a mismatch yields nothing rather than the wrong
 * file.** Only macOS used to look: Windows matched the first `.exe` in the list and Linux the first
 * `.AppImage`, and since GitHub returns assets alphabetically, `Lyra-0.6.1-arm64.exe` sorts before
 * `Lyra-0.6.1-x64.exe` — so every Intel Windows machine was being handed the ARM installer, and
 * every Intel Linux machine the ARM AppImage. It would download the whole thing and fail at the
 * end, which is the worst place to fail.
 *
 * A file with no architecture in its name is taken as universal, because it is: `Lyra-0.6.1.exe`
 * is the combined NSIS installer that carries both. That fallback is also what keeps older
 * releases installable, from before the artifact names carried an architecture at all.
 */
export function pickAsset(
	assets: ReleaseAsset[],
	platform: string = process.platform,
	arch: string = process.arch,
): PickedAsset | null {
	const named = assets.filter((asset): asset is Required<ReleaseAsset> =>
		Boolean(asset.name && asset.browser_download_url && typeof asset.size === "number"),
	);

	const mine = ARCH_TAGS[arch] ?? [];
	const others = Object.entries(ARCH_TAGS)
		.filter(([name]) => name !== arch)
		.flatMap(([, tags]) => tags);

	const forThisMachine = (name: string) => mine.some((tag) => name.includes(tag));
	// Universal only if it names *no* architecture — `x86_64` must not read as "not arm64".
	const universal = (name: string) => !mine.some((tag) => name.includes(tag)) && !others.some((tag) => name.includes(tag));

	const extensions =
		platform === "darwin" ? [".zip"] : platform === "win32" ? [".exe", ".msi"] : [".appimage", ".deb"];

	for (const extension of extensions) {
		const candidates = named.filter((asset) => asset.name.toLowerCase().endsWith(extension));
		// Exact architecture first, and only then something that claims to run anywhere.
		const match =
			candidates.find((asset) => forThisMachine(asset.name.toLowerCase())) ??
			candidates.find((asset) => universal(asset.name.toLowerCase()));
		if (match) return { name: match.name, url: match.browser_download_url, size: match.size };
	}

	return null;
}

/**
 * The release's checksum file, if it published one.
 *
 * Matched by exact name rather than by extension: it is written by `sha256sum *` in the release
 * workflow and there is only ever one. Releases from before that step existed have none, and the
 * caller decides what to do about it — see `update-checksum.ts`.
 */
export function pickChecksums(assets: ReleaseAsset[]): { url: string } | null {
	const found = assets.find((asset) => asset.name === CHECKSUM_ASSET && asset.browser_download_url);
	return found ? { url: found.browser_download_url as string } : null;
}
