import type { GitCommit } from "../../../electron/ipc-types.ts";

/** One drawn row: where this commit's dot sits, and every line passing through the row. */
export interface GraphRow {
  commit: GitCommit;
  /** Column of this commit's dot. */
  lane: number;
  /** A line occupying `lane` for the whole row height. */
  through: { lane: number; colour: number }[];
  /** A line leaving this commit's dot for `to` on the next row — a parent, in other words. */
  out: { to: number; colour: number }[];
  /** Lines arriving at this dot from lanes above it: this commit is where they merged in. */
  merges: { from: number; colour: number }[];
  colour: number;
}

/** How many columns the graph is allowed to grow to before it stops being worth the width. */
const MAX_LANES = 8;

/**
 * Lay commits out into lanes, the way every git GUI draws them.
 *
 * The list is already topologically ordered, so a single pass suffices: keep a row of "open"
 * lanes, each holding the sha the lane is waiting for. A commit takes the lane that was waiting
 * for it — that is the line coming down from its children — and hands the lane on to its first
 * parent. Any further parent is a merge, and takes a lane of its own, which is what produces
 * the sideways strokes.
 *
 * The colour is the lane's, not the commit's, so a line keeps one colour from the moment it
 * branches to the moment it merges back. That is the entire point of drawing this: you follow
 * a colour up the column and it tells you where the work came from.
 */
export function buildGraph(commits: GitCommit[]): GraphRow[] {
  /** Lane -> the sha that lane is currently waiting to draw. */
  let open: (string | null)[] = [];
  const colours = new Map<number, number>();
  let nextColour = 0;

  const colourFor = (lane: number): number => {
    const existing = colours.get(lane);
    if (existing !== undefined) return existing;
    const assigned = nextColour++;
    colours.set(lane, assigned);
    return assigned;
  };

  return commits.map((commit) => {
    let lane = open.indexOf(commit.sha);
    if (lane === -1) {
      // A tip: nothing above was waiting for it, so it starts a lane of its own.
      lane = open.findIndex((slot) => slot === null);
      if (lane === -1) lane = Math.min(open.length, MAX_LANES - 1);
      colours.delete(lane);
    }
    const colour = colourFor(lane);

    // Every other lane holding this same sha is a line merging into this dot.
    const merges: { from: number; colour: number }[] = [];
    open = open.map((slot, index) => {
      if (index !== lane && slot === commit.sha) {
        merges.push({ from: index, colour: colourFor(index) });
        colours.delete(index);
        return null;
      }
      return slot;
    });

    /*
     * Lines that pass this row untouched.
     *
     * Captured before the parents are placed, so a lane this commit is about to occupy does
     * not also get drawn as passing through it.
     */
    const through = open
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot, index }) => slot !== null && index !== lane)
      .map(({ index }) => ({ lane: index, colour: colourFor(index) }));

    const out: { to: number; colour: number }[] = [];
    const [first, ...rest] = commit.parents;

    if (first) {
      open[lane] = first;
      out.push({ to: lane, colour });
    } else {
      // A root commit: the lane ends here.
      open[lane] = null;
      colours.delete(lane);
    }

    for (const parent of rest) {
      // A parent already on screen keeps its lane; the merge line runs to where it is.
      const existing = open.indexOf(parent);
      if (existing !== -1) {
        out.push({ to: existing, colour: colourFor(existing) });
        continue;
      }
      let slot = open.findIndex((value) => value === null);
      if (slot === -1) {
        if (open.length >= MAX_LANES) continue;
        slot = open.length;
      }
      open[slot] = parent;
      colours.delete(slot);
      out.push({ to: slot, colour: colourFor(slot) });
    }

    // Trim trailing empties so the graph narrows again once branches are merged away.
    while (open.length > 0 && open[open.length - 1] === null) open.pop();

    return { commit, lane, through, out, merges, colour };
  });
}

/** The width the graph column needs for a given set of rows. */
export function graphWidth(rows: GraphRow[], laneWidth: number): number {
  const widest = rows.reduce((max, row) => {
    const lanes = [
      row.lane,
      ...row.through.map((line) => line.lane),
      ...row.out.map((line) => line.to),
    ];
    return Math.max(max, ...lanes.map((lane) => lane + 1));
  }, 1);
  return widest * laneWidth;
}
