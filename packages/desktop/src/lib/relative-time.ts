/**
 * How long ago, in the units a person would use.
 */

/** Coarse on purpose: the exact minute of a commit is never the question in a list. */
export function relativeTime(iso: string, now = Date.now()): string {
  const span = spanOf(iso, now);
  return span && span !== "刚刚" ? `${span}前` : span;
}

/**
 * The same span without the 前, for the corner of a row.
 *
 * The list draws this against the right edge of a column that also has to hold a title, and every
 * character here is one the title does not get. Next to a title an age reads as an age without
 * being told so, which is why every code host writes it this way in the same position.
 *
 * `now` is a parameter rather than a call so that a component can re-render on a shared clock —
 * one timer for the whole list instead of one per row — and so this stays a function that can be
 * tested without freezing time.
 */
export function shortRelativeTime(iso: string, now = Date.now()): string {
  return spanOf(iso, now);
}

/** The exact moment, for the tooltip behind a rounded-off one. */
export function exactTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function spanOf(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天`;
  /*
   * Months and years, not a date.
   *
   * A list is scanned for "how stale is this", and "2026年7月12日" makes the reader do the
   * subtraction — in a column beside a dozen others doing the same. It is also twice as wide,
   * which is what pushed the titles next to it into an ellipsis.
   */
  const months = Math.round(days / 30);
  if (months < 12) return `${months} 个月`;
  return `${Math.round(months / 12)} 年`;
}

/**
 * The repository this panel is looking at, and everywhere else it could look.
 *
 * A workspace is a folder someone opened. Plenty of them hold several repositories — a frontend
 * beside a backend, services versioned apart on purpose — and any repository may have worktrees,
 * which are further checkouts of the same history on other branches. All of it was being found
 * and none of it was reachable: the panel picked whichever repository sorted first and gave no
 * way to say otherwise.
 *
 * Worktrees are nested under the repository they belong to rather than listed as peers, because
 * that is what they are. Sharing one history is the whole point of a worktree, and a flat list
 * would put two checkouts of the same project side by side as though they were separate work.
 */
