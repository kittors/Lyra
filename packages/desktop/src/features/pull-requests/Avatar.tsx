/**
 * A GitHub account, as a face.
 *
 * A name alone makes a timeline read as a log. Faces are what let you find the one human comment
 * among nine from a bot without reading any of them — recognition rather than reading, which is
 * the whole reason avatars exist on every code host.
 *
 * The image comes from the main process as a data URL. The renderer's Content-Security-Policy
 * allows no remote images on purpose, and widening it for a 20pt circle would widen it for every
 * rendered comment body as well.
 *
 * The initial is the resting state, not the error state: it is drawn immediately, the picture
 * replaces it if one arrives, and nothing about the layout moves either way. A bot with no avatar,
 * a machine with no network and a first paint all look the same, which is what stops this from
 * flickering through a placeholder on every render.
 *
 * Everything about *when* it arrives lives in `avatar-cache`, which is shared by every one of
 * these on screen — see there for why this component no longer fetches anything itself.
 */

import { useAvatar } from "./avatar-cache.ts";

export function Avatar({
	accountId,
	login,
	url,
	size = 18,
}: {
	/**
	 * Which signed-in account this name was seen through.
	 *
	 * Required, because a login only means something within one host. Without it, a `kittors` on a
	 * work GitLab and a `kittors` on github.com share a cache entry, and whichever list loaded
	 * first decides what the other one's face is.
	 */
	accountId: string;
	login: string;
	/** Where the host said the picture is. Absent falls back to the account's own address. */
	url?: string | null;
	size?: number;
}) {
	const src = useAvatar(accountId, login, url);

	return (
		<span
			aria-hidden
			style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.52)) }}
			className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-card leading-none text-ink-faint select-none"
		>
			{src ? (
				<img src={src} alt="" width={size} height={size} className="h-full w-full object-cover" draggable={false} />
			) : (
				(login[0] ?? "?").toUpperCase()
			)}
		</span>
	);
}
