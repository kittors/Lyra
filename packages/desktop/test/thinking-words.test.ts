/**
 * What the running line says, and which orb it draws while saying it.
 *
 * One classification serves both — the phrase and the animation are the same reading of what the
 * agent is doing, so a tool landing on the wrong mood is wrong twice over and visibly so. These
 * check the rule rather than the wording: which bucket a tool falls into, that every bucket is
 * reachable, and that the two things nothing else can express — a reconnect, and a test run
 * arriving through an ordinary shell command — win over the plain tool name.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { moodFor, phraseFor, type Mood } from "../src/lib/thinking-words.ts";

/** Every state the orb can draw. A mood outside this set would not render. */
const STATES: Mood[] = [
	"working",
	"searching",
	"solving",
	"listening",
	"connecting",
	"weaving",
	"composing",
	"breathing",
	"shaping",
];

test("nothing running is the model thinking", () => {
	assert.equal(moodFor(undefined, undefined), "breathing");
	assert.equal(moodFor("", ""), "breathing");
});

test("the silence has two halves: reasoning, and the answer arriving", () => {
	/*
	 * Both look like "no tool is running", and telling them apart is most of what makes the mark
	 * move at all — a turn spends far more time here than it does inside any tool.
	 */
	assert.equal(moodFor(undefined, undefined, false, false), "breathing", "reasoning, nothing to show");
	assert.equal(moodFor(undefined, undefined, false, true), "composing", "the reply is being typed out");
});

test("a running tool is more specific than text streaming, so it wins", () => {
	assert.equal(moodFor("grep", "TODO", false, true), "searching");
	assert.equal(moodFor("bash", "pnpm test", false, true), "solving");
});

test("a reconnect still beats everything, including text arriving", () => {
	assert.equal(moodFor(undefined, undefined, true, true), "connecting");
});

test("the words for reaching the web are not the words for the network dropping", () => {
	/*
	 * The orb is right for both — a fetch and a dropped socket are the same picture, wires trying to
	 * find each other — and the words are not. This pool is written for going out to the web, so a
	 * turn whose connection had just died announced 「Loading the page…」 next to 「连接中断，14 秒
	 * 后重试」: two accounts of the same moment, one of them wrong.
	 *
	 * `RunningIndicator` drops the phrase entirely while retrying, because the countdown beside it
	 * already says what is happening and for how long. This pins what that phrase would have been,
	 * so the mistake is visible here rather than only on screen.
	 */
	const words = [0, 1, 2, 3].map((tick) => phraseFor("connecting", tick, 0));
	assert.ok(
		words.some((word) => word.includes("page") || word.includes("web")),
		`the pool is about fetching pages (${words.join(", ")})`,
	);
});

test("a tool nobody mapped falls back rather than picking something wrong", () => {
	assert.equal(moodFor("some_future_tool", "doing a thing"), "breathing");
});

test("each family of tool gets the animation that is about the same thing", () => {
	const cases: [string, Mood][] = [
		["read", "listening"],
		["symbol", "listening"],
		["write", "composing"],
		["preview", "composing"],
		["edit", "shaping"],
		["bash", "working"],
		["bash_output", "working"],
		["grep", "searching"],
		["glob", "searching"],
		["ls", "searching"],
		["todo_write", "weaving"],
		["task", "weaving"],
		["web_fetch", "connecting"],
		["web_search", "connecting"],
		["browser_act", "connecting"],
	];
	for (const [tool, mood] of cases) {
		assert.equal(moodFor(tool, "some summary"), mood, `${tool} → ${mood}`);
	}
});

test("a test run is solving, whichever tool it arrived through", () => {
	// The distinction the tool name cannot make: `bash` is `working`, but a test suite is the one
	// kind of command whose whole point is that it either passes or does not.
	assert.equal(moodFor("bash", "pnpm test"), "solving");
	assert.equal(moodFor("bash", "npx vitest run src/"), "solving");
	assert.equal(moodFor("bash", "pytest -q"), "solving");
	assert.equal(moodFor("bash", "go test ./... -coverage"), "solving");
	// And an ordinary command still is not.
	assert.equal(moodFor("bash", "pnpm build"), "working");
	assert.equal(moodFor("bash", "git status"), "working");
});

test("the hint is a word, not a substring", () => {
	// `latest`, `contest`, `testing.md` — the trap a bare /test/ would fall into.
	assert.equal(moodFor("bash", "npm view react version --latest"), "working");
	assert.equal(moodFor("read", "docs/contest-rules.md"), "listening");
});

test("waiting on a reconnect wins over whatever tool ran last", () => {
	/*
	 * The one case where the last tool is actively misleading: the turn is not reading a file, it
	 * is doing nothing at all until the network is back, and an orb still animating "reading" is
	 * the only thing on screen claiming progress.
	 */
	assert.equal(moodFor("read", "src/index.ts", true), "connecting");
	assert.equal(moodFor("bash", "pnpm test", true), "connecting");
	assert.equal(moodFor(undefined, undefined, true), "connecting");
});

test("every orb state is reachable, so none of the nine is decoration", () => {
	const reached = new Set<Mood>();
	for (const tool of ["read", "write", "edit", "bash", "grep", "task", "web_fetch", "", "unknown"]) {
		reached.add(moodFor(tool || undefined, ""));
	}
	reached.add(moodFor("bash", "pnpm test"));
	reached.add(moodFor(undefined, undefined, true));
	assert.deepEqual([...reached].sort(), [...STATES].sort(), "all nine states have a route into them");
});

test("every state has words to go with it", () => {
	for (const state of STATES) {
		const phrase = phraseFor(state, 0, 0);
		assert.ok(phrase && phrase.length > 0, `${state} has a phrase`);
	}
});

test("the phrase advances with the tick rather than with the render", () => {
	const first = phraseFor("searching", 0, 0);
	// Same inputs, same answer: a re-render must not reshuffle the words.
	assert.equal(phraseFor("searching", 0, 0), first);
	// A later tick moves on, and the pool wraps rather than running out.
	assert.notEqual(phraseFor("searching", 1, 0), first);
	assert.equal(phraseFor("searching", 5, 0), first, "five words in the searching pool, so it wraps");
});

test("a step that has gone on too long says so, whatever it is doing", () => {
	const patient = 46_000;
	for (const state of STATES) {
		const phrase = phraseFor(state, 0, patient);
		assert.equal(phrase, "Still at it", `${state} acknowledges the wait rather than repeating itself`);
	}
});
