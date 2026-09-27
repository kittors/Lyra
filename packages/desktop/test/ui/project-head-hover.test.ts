/**
 * 项目行悬停时，标题只给真正压在它上面的那一段按钮让位，和会话行是同一套。
 *
 * 悬停按钮条（`HoverRowReveal`）量出自己压住了标题多少，写进行上的 `--ly-row-controls`。遮罩在悬停时
 * 按它清掉标题的尾巴，`ScrollText` 按它判断悬停后读不读得全。项目行原来给计数留了一个常驻的尾部槽，
 * 标题在按钮左边就停了，量出来是负数；负数原来直接不写，`hoverSlot(2)` 的 48px 回退值一直留着。结果是
 * 一个装得下的项目名一悬停就开始滚、左边虚化，右边离按钮还有一大截就化没了；展开的项目静止时右边还
 * 空着 56px，给一个永远是空的计数槽。
 *
 * happy-dom 不做布局，也不让自定义属性往下继承。几何按真窗口（侧栏 272px）量到的数摆进去：项目行标题
 * 从 43 起，按钮条 206–262；继承补一层。ResizeObserver 换成记账的：哪个元素变了尺寸，就按浏览器的规矩
 * 只通知看着它的观察器，按创建先后——真窗口里 `ScrollText` 的观察器就是比按钮条的先触发。
 */

import assert from "node:assert/strict";
import { beforeEach, test, type TestContext } from "node:test";
import { act, createElement as h } from "react";
import type { SessionMeta } from "@lyra/core";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { useApp } from "../../src/store/index.ts";
import { ProjectHead } from "../../src/features/sidebar/ProjectHead.tsx";
import type { Group } from "../../src/features/sidebar/grouping.ts";
import { mount } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };
const session = (id: string): SessionMeta => ({ id, title: id, cwd: "/work/bid", projectId: "bid", projectName: "P", createdAt: 1, updatedAt: 1, modelId: "", messageCount: 1, seq: 2, usage });
const group = (name: string): Group => ({ path: "/work/bid", name, sessions: ["a", "b", "c", "d"].map(session) });

/** 标题盒的左右缘、按钮条的左右缘。每条测试自己摆，也可以中途改（收起时标题变窄）。 */
const geometry = { titleLeft: 43, titleRight: 254, stripLeft: 206, stripRight: 262 };
/** 汉字 14px，其余 7px：真窗口里 13px 的 PingFang 量出来就是这个数。 */
const textWidth = (text: string) => [...text].reduce((sum, ch) => sum + (/[　-鿿＀-￯]/.test(ch) ? 14 : 7), 0);

function replace(t: TestContext, target: object, key: PropertyKey, descriptor: PropertyDescriptor) {
	const previous = Object.getOwnPropertyDescriptor(target, key);
	Object.defineProperty(target, key, { configurable: true, ...descriptor });
	t.after(() => {
		if (previous) Object.defineProperty(target, key, previous);
		else Reflect.deleteProperty(target, key);
	});
}

class RecordingObserver {
	static live: RecordingObserver[] = [];
	readonly targets = new Set<Element>();
	constructor(readonly callback: ResizeObserverCallback) {
		RecordingObserver.live.push(this);
	}
	observe(target: Element) {
		this.targets.add(target);
	}
	unobserve(target: Element) {
		this.targets.delete(target);
	}
	disconnect() {
		this.targets.clear();
	}
}

/** 这个元素变了尺寸：只有看着它的观察器收到，按创建先后。 */
function resized(target: Element) {
	return act(async () => {
		for (const observer of RecordingObserver.live) {
			if (observer.targets.has(target)) observer.callback([], observer as unknown as ResizeObserver);
		}
	});
}

function layout(t: TestContext) {
	RecordingObserver.live = [];
	// LayoutProvider 要问一句平台；桥的其余部分这几条用不到。
	replace(t, window, "lyra", { value: { platform: "darwin" }, writable: true });
	replace(t, globalThis, "ResizeObserver", { value: RecordingObserver, writable: true });
	const rect = (left: number, right: number) => new DOMRect(left, 0, right - left, 31);
	replace(t, HTMLElement.prototype, "getBoundingClientRect", {
		value(this: HTMLElement) {
			if (this.hasAttribute("data-ly-hover-reveal")) return rect(geometry.stripLeft, geometry.stripRight);
			if (this.classList.contains("ly-fade-tail")) return rect(geometry.titleLeft, geometry.titleRight);
			return rect(0, 0);
		},
	});
	// ScrollText 比的是布局尺寸：标题盒的 clientWidth，和文字那一格的 offsetWidth。
	replace(t, HTMLElement.prototype, "clientWidth", {
		get(this: HTMLElement) {
			return this.classList.contains("ly-fade-tail") ? geometry.titleRight - geometry.titleLeft : 0;
		},
	});
	replace(t, HTMLElement.prototype, "offsetWidth", {
		get(this: HTMLElement) {
			const inTitle = this.parentElement?.parentElement?.classList.contains("ly-fade-tail");
			return inTitle && !this.hasAttribute("data-ly-scroll-dup") ? textWidth(this.textContent ?? "") : 0;
		},
	});
	// 自定义属性要往下继承：ScrollText 在标题盒上读的 --ly-row-controls 是写在行上的。
	const original = globalThis.getComputedStyle;
	replace(t, globalThis, "getComputedStyle", {
		writable: true,
		value: (el: Element, pseudo?: string | null) => {
			const style = original(el, pseudo);
			return new Proxy(style, {
				get(target, key) {
					if (key === "getPropertyValue") {
						return (name: string) => {
							const own = target.getPropertyValue(name);
							if (own || !name.startsWith("--")) return own;
							for (let at = el.parentElement; at; at = at.parentElement) {
								const value = at.style.getPropertyValue(name);
								if (value) return value;
							}
							return "";
						};
					}
					const value = Reflect.get(target, key, target);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
		},
	});
}

const head = (name: string, collapsed = false) =>
	h(LayoutProvider, null, h(ProjectHead, { group: group(name), active: false, collapsed, onToggleCollapsed: () => {} }));

beforeEach(() => {
	useApp.setState({ activity: {}, activeSessionId: null });
	Object.assign(geometry, { titleLeft: 43, titleRight: 254, stripLeft: 206, stripRight: 262 });
});

test("按钮条压不到标题时，让位写 0，不留着回退的 48px", async (t) => {
	layout(t);
	// 修之前的布局：标题停在常驻计数槽前面（198），按钮条从 206 起，压不到它。
	geometry.titleRight = 198;
	const view = await mount(head("智能投标对外公开项目"));
	try {
		assert.equal(view.find("[data-ly-project]").style.getPropertyValue("--ly-row-controls"), "0px");
		// 140px 的名字放进 155px 的盒子，悬停也没有东西压上来：不滚，也不挂虚化。
		const title = view.find(".ly-fade-tail");
		assert.equal(title.getAttribute("data-ly-scroll-fit"), null);
		assert.doesNotMatch(title.className, /\bly-fade-edge\b/);
	} finally {
		await view.unmount();
	}
});

test("展开时标题铺满整行，按钮压住多少就让多少，装得下的名字悬停不滚", async (t) => {
	layout(t);
	const fits = await mount(head("智能投标对外公开项目"));
	const covered = await mount(head("智能投标对外公开项目管理"));
	try {
		// 展开时尾部槽里什么都没有，也不占位：标题这才铺得满。
		const slot = fits.find("[data-ly-project] > button > :last-child");
		assert.equal(slot.childNodes.length, 0);
		assert.match(slot.className, /\bempty:hidden\b/);
		assert.doesNotMatch(slot.className, /\bw-\[/);
		// 标题 43–254，按钮条从 206 起：压住 48px。
		assert.equal(fits.find("[data-ly-project]").style.getPropertyValue("--ly-row-controls"), "48px");
		// 140px，可读 163：不滚。
		assert.equal(fits.find(".ly-fade-tail").getAttribute("data-ly-scroll-fit"), null);
		// 168px：静止时装得下，悬停时尾巴被按钮压住。和会话行一样让位，悬停时自己读出来。
		assert.equal(covered.find(".ly-fade-tail").getAttribute("data-ly-scroll-fit"), "yield");
	} finally {
		await fits.unmount();
		await covered.unmount();
	}
});

test("收起时计数挤进来、标题变窄，按钮条跟着重量，ScrollText 用新的让位重判", async (t) => {
	layout(t);
	/*
	 * 11 个字，154px。展开时可读 206 − 43 = 163，装得下。收起后标题 43–234.8，按钮条没动，可读仍是 163，
	 * 照样装得下；拿旧的 48px 去判（191.8 − 48 = 143.8）才会误判成要滚。
	 */
	const name = "智能投标对外公开项目组";
	const view = await mount(head(name));
	try {
		const title = view.find(".ly-fade-tail");
		assert.equal(title.getAttribute("data-ly-scroll-fit"), null);

		await view.rerender(head(name, true));
		assert.equal(view.find("[data-ly-project] > button > :last-child").textContent, "4");
		// 行和按钮条的尺寸都没变，变的只有标题。
		geometry.titleRight = 234.8;
		await resized(title);

		assert.equal(view.find("[data-ly-project]").style.getPropertyValue("--ly-row-controls"), "29px");
		assert.equal(title.getAttribute("data-ly-scroll-fit"), null);
	} finally {
		await view.unmount();
	}
});
