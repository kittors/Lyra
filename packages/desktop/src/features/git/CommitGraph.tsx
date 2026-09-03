import type { GraphRow } from "./graph.ts";

/** Lane colours, drawn from the palette the rest of the app already uses. */
const LANE_COLOURS = [
  "var(--color-accent)",
  "var(--color-ok)",
  "var(--color-violet)",
  "var(--color-info)",
  "var(--color-danger)",
  "var(--color-ink-muted)",
];

export const LANE_WIDTH = 13;

/**
 * One stroke for every line in the graph, wherever it is drawn.
 *
 * There were three sets of values: the commit row's in/out curves at 0.85, the lines passing
 * through that row at 0.75, and the continuation below an expanded commit at 0.75 again. Which
 * meant a single branch changed opacity twice on its way down the page — once entering a commit
 * row and once leaving it — and the seam is visible: the line reads as several lines that happen
 * to line up rather than as one continuous thing.
 *
 * The 0.75/0.85 split was presumably meant to push passing lanes back a step, but a tenth of an
 * alpha is not enough to read as depth and is more than enough to read as a join.
 */
export const GRAPH_STROKE = 1.5;
export const GRAPH_OPACITY = 0.85;

function laneColour(index: number): string {
  return LANE_COLOURS[index % LANE_COLOURS.length];
}

/**
 * One row of the commit graph, drawn beside its commit.
 *
 * Per row rather than one tall SVG for the list: rows are already a scrolling column of
 * variable height — a commit expands to show its diff — and a single canvas would have to be
 * re-measured and re-drawn on every expansion. Each row draws only what crosses it, so the
 * graph stays correct however the list reflows.
 *
 * The dot sits at the row's vertical centre; lines run edge to edge, so consecutive rows join
 * up seamlessly without either row knowing anything about the other.
 */
export function CommitGraph({
  row,
  height,
  width,
}: {
  row: GraphRow;
  height: number;
  width: number;
}) {
  const x = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2;
  const mid = height / 2;

  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0"
      // Stated rather than left to the attributes: inside a stretching flex row the element
      // takes the row's cross size and the strokes end up drawn at a fraction of their height.
      style={{ overflow: "visible", width, height }}
    >
      {/* Lines that pass this commit by, drawn first so the dot sits on top of them. */}
      {row.through.map((line) => (
        <line
          key={`t${line.lane}`}
          x1={x(line.lane)}
          y1={0}
          x2={x(line.lane)}
          y2={height}
          stroke={laneColour(line.colour)}
          strokeWidth={GRAPH_STROKE}
          opacity={GRAPH_OPACITY}
        />
      ))}

      {/* The line coming down into this dot from the commits above it. */}
      <line
        x1={x(row.lane)}
        y1={0}
        x2={x(row.lane)}
        y2={mid}
        stroke={laneColour(row.colour)}
        strokeWidth={GRAPH_STROKE}
        opacity={GRAPH_OPACITY}
      />

      {/*
       * Lines merging in, curved rather than angled.
       *
       * A merge is the one place two lanes meet, and a bezier reads as one line arriving
       * where a corner reads as two lines that happen to touch.
       */}
      {row.merges.map((line) => (
        <path
          key={`m${line.from}`}
          d={`M ${x(line.from)} 0 C ${x(line.from)} ${mid * 0.6}, ${x(row.lane)} ${mid * 0.4}, ${x(row.lane)} ${mid}`}
          fill="none"
          stroke={laneColour(line.colour)}
          strokeWidth={GRAPH_STROKE}
          opacity={GRAPH_OPACITY}
        />
      ))}

      {/* Lines leaving for this commit's parents. */}
      {row.out.map((line) =>
        line.to === row.lane ? (
          <line
            key={`o${line.to}`}
            x1={x(row.lane)}
            y1={mid}
            x2={x(row.lane)}
            y2={height}
            stroke={laneColour(line.colour)}
            strokeWidth={GRAPH_STROKE}
            opacity={GRAPH_OPACITY}
          />
        ) : (
          <path
            key={`o${line.to}`}
            d={`M ${x(row.lane)} ${mid} C ${x(row.lane)} ${mid + (height - mid) * 0.4}, ${x(line.to)} ${mid + (height - mid) * 0.6}, ${x(line.to)} ${height}`}
            fill="none"
            stroke={laneColour(line.colour)}
            strokeWidth={GRAPH_STROKE}
            opacity={GRAPH_OPACITY}
          />
        ),
      )}

      {/*
       * A merge commit is drawn hollow.
       *
       * It has more than one parent, which is exactly the thing worth spotting while
       * scanning a column — and the ring says it without needing a legend.
       */}
      <circle
        cx={x(row.lane)}
        cy={mid}
        r={3.5}
        fill={
          row.commit.parents.length > 1
            ? "var(--color-shell)"
            : laneColour(row.colour)
        }
        stroke={laneColour(row.colour)}
        strokeWidth={GRAPH_STROKE}
      />
    </svg>
  );
}

/**
 * Continuous branch lines drawn through an expanded diff block below a commit.
 *
 * It draws straight through-lines for all lanes leaving this commit row (`row.out`)
 * as well as all passing lanes (`row.through`), ensuring the topological graph
 * line is never broken when a commit is expanded.
 */
export function CommitThroughGraph({
  row,
  width,
}: {
  row: GraphRow;
  width: number;
}) {
  const x = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2;

  // Active lanes that need to continue through the expanded region
  const activeLines = new Map<number, number>();
  for (const line of row.through) {
    activeLines.set(line.lane, line.colour);
  }
  for (const line of row.out) {
    activeLines.set(line.to, line.colour);
  }

  const lines = Array.from(activeLines.entries()).map(([lane, colour]) => ({
    lane,
    colour,
  }));

  if (lines.length === 0) {
    return <div style={{ width }} className="shrink-0" />;
  }

  /*
   * Absolutely positioned inside a stretched box, rather than `height="100%"` on the svg itself.
   *
   * That attribute is what kept the lines short. It takes the height out of `auto`, so the flex
   * row's `items-stretch` no longer applies; and the percentage then resolves against a parent
   * whose height is decided by its content — of which the svg is part. Circular, so the browser
   * falls back to a replaced element's default 150px. Measured against a 26-file diff: the block
   * was 3968px tall and the line was drawn 150px, about four per cent of the way down.
   *
   * The wrapper is a plain box with `height: auto`, so it does stretch; the svg fills it.
   */
  return (
    <div className="relative shrink-0" style={{ width }}>
      <svg
        aria-hidden
        className="absolute inset-0 h-full w-full"
        style={{ overflow: "visible" }}
      >
        {lines.map((line) => (
          <line
            key={`cont-${line.lane}`}
            x1={x(line.lane)}
            y1={0}
            x2={x(line.lane)}
            y2="100%"
            stroke={laneColour(line.colour)}
            strokeWidth={GRAPH_STROKE}
            opacity={GRAPH_OPACITY}
          />
        ))}
      </svg>
    </div>
  );
}
