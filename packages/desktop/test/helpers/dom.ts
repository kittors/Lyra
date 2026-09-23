/**
 * A DOM for the component tests, installed before any of them runs.
 *
 * The unit tests in this package are pure functions and need no browser; the ones under `test/ui/`
 * mount real components, and those need a document. `happy-dom` provides one — it is a DOM
 * implementation rather than a test framework, so `node:test` stays what runs the tests.
 *
 * Loaded with `--import`, which is the only point early enough: React reads `document` while its
 * module graph is being evaluated, so setting these up inside a test would already be too late for
 * anything imported at the top of that file.
 */

import { Window } from "happy-dom";

const w = new Window({ url: "http://localhost" });

/*
 * `defineProperty` rather than `Object.assign`.
 *
 * Node 24 defines `globalThis.navigator` as an accessor with only a getter, so assigning to it
 * throws "Cannot set property navigator of #<Object> which has only a getter" — and it throws while
 * this file is being evaluated, so every test in the run fails with a stack that points here rather
 * than at any test. It reads like a broken install of happy-dom.
 */
const globals: Record<string, unknown> = {
	window: w,
	document: w.document,
	HTMLElement: w.HTMLElement,
	HTMLInputElement: w.HTMLInputElement,
	HTMLTextAreaElement: w.HTMLTextAreaElement,
	HTMLButtonElement: w.HTMLButtonElement,
	Element: w.Element,
	Node: w.Node,
	Event: w.Event,
	CustomEvent: w.CustomEvent,
	KeyboardEvent: w.KeyboardEvent,
	MouseEvent: w.MouseEvent,
	navigator: w.navigator,
	// A popover opened at a point — a right-click menu — builds its anchor rect with `new DOMRect`.
	DOMRect: w.DOMRect,
	getComputedStyle: w.getComputedStyle.bind(w),
	/*
	 * Timers rather than real frames.
	 *
	 * happy-dom has no compositor, so a callback queued for "the next frame" would never run and a
	 * component that measures itself after one would hang until the test times out. 16ms keeps the
	 * ordering — after a microtask, before a 50ms timer — without pretending to be a display.
	 */
	requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number,
	cancelAnimationFrame: (id: number) => clearTimeout(id as unknown as NodeJS.Timeout),
	/*
	 * Observers the layout code constructs and this DOM does not implement.
	 *
	 * Stubbed as never-firing rather than left undefined: a component that builds one in an effect
	 * would throw, and what these tests check is what it renders, not how it reacts to a resize that
	 * cannot happen here. A test that needs the callback can hold the instance and call it.
	 */
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	IntersectionObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
		takeRecords() {
			return [];
		}
	},
	MutationObserver: class {
		observe() {}
		disconnect() {}
		takeRecords() {
			return [];
		}
	},
	matchMedia: (query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
		dispatchEvent: () => false,
	}),
	/*
	 * 记界面偏好的地方——在内存里，但真的记得住。
	 *
	 * 应用里好几处直接用裸 `localStorage` 存「上次选的是哪个」：侧边栏的标签页、排序、折叠，
	 * 改动列表的平铺还是树。这套 DOM 不带它，于是第一个被挂进测试的这类组件会在渲染中途抛
	 * `localStorage is not defined`——报出来是那个文件里所有用例一起红，看着像组件坏了。
	 *
	 * 不用 happy-dom 自带的：它按 window 走，而这些组件用的是全局那一个。行为完整（存得住、读
	 * 得回、删得掉），因为「点了树形，重新挂上来还是不是树形」这类用例要的正是它记得住。
	 */
	localStorage: (() => {
		const store = new Map<string, string>();
		return {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => void store.set(key, String(value)),
			removeItem: (key: string) => void store.delete(key),
			clear: () => store.clear(),
			key: (index: number) => [...store.keys()][index] ?? null,
			get length() {
				return store.size;
			},
		};
	})(),
};

for (const [key, value] of Object.entries(globals)) {
	Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
}

// React checks this before allowing `act`, and warns on every render without it.
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, writable: true, configurable: true });
