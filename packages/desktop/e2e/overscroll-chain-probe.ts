/**
 * 鼠标停在一块内层滚动面上时，滚轮还传不传得到外面。
 *
 * `node --experimental-strip-types e2e/overscroll-chain-probe.ts`
 *
 * 现场：设置页「关于」里那张「当前版本更新内容」卡片，鼠标放上去页面就滚不动了，移开又好。那张
 * 卡片包在一个 `Scroller` 里（`AboutSettings.tsx`），用的是默认的 `overscroll="contain"`。
 *
 * 要分清的是两种情况，它们的答案不一定一样：
 *
 *   - **内层可滚、已经滚到底**：`contain` 拦住后续的滚轮，这是它存在的理由，不是毛病。
 *   - **内层压根不可滚**（内容没超过 `max-h`）：这才是现场——截图里那张卡片高约 320px，而上限是
 *     380px。一个滚不动的盒子按说该把滚轮让给外面，可 `overflow-y: auto` 的元素即使内容不溢出
 *     仍然是个 scroll container，`overscroll-behavior` 照样生效。
 *
 * 所以这里不猜，拿真滚轮去问：在设置页那张真实可滚的外层面里，就地造一个内层盒子，两种溢出状态
 * 各试 `contain` 和 `auto`，看外层的 `scrollTop` 动没动。用 CDP 派发 `mouseWheel`——`dispatchEvent`
 * 造的 wheel 不走浏览器的滚动链，问它等于没问。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const PORT = 9470;
const OUT = "/tmp/lyra-overscroll-probe";
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function check(label: string, passed: boolean, evidence: string): void {
	if (!passed) failures++;
	process.stdout.write(`${passed ? "✓" : "✗"} ${label}\n    ${evidence}\n`);
}

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "one.ts"), "export const one = 1\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			permissionMode: "full",
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4521, token: null },
			appearance: { theme: "light" },
		}),
	);
}

await mkdir(OUT, { recursive: true });
const app = await startApp({ port: PORT, seed });

try {
	// 进设置：侧边栏最底下那条（齿轮 + 供应商名），见 SidebarFoot。
	await app.evaluate(`(() => {
		const foot = document.querySelector(".ly-sidebar-foot button");
		if (foot) foot.click();
		return true;
	})()`);
	await settle(1_500);

	/* 外层那面必须真的能滚，否则「传没传出去」这个问题本身不成立。 */
	const outer = await app.evaluate<{ found: boolean; scrollable: number }>(`(() => {
		const views = [...document.querySelectorAll("[data-ly-settings] .ly-scroll-view")];
		const el = views.map((v) => ({ v, room: v.scrollHeight - v.clientHeight })).sort((a, b) => b.room - a.room)[0];
		if (!el) return { found: false, scrollable: 0 };
		window.__outer = el.v;
		return { found: true, scrollable: el.room };
	})()`);
	check("设置页有一面真的能滚的外层", outer.found && outer.scrollable > 50, `可滚 ${outer.scrollable}px`);

	/**
	 * 在外层里就地造一个内层盒子。
	 *
	 * `tall` 决定它自己滚不滚得动：`false` 时内容比盒子矮，它是个滚不动的盒子——也就是现场那张卡片
	 * 的样子。返回盒子中心的视口坐标，滚轮要派到那儿去。
	 */
	const plant = async (behavior: string, tall: boolean) =>
		app.evaluate<{ x: number; y: number; room: number }>(`(() => {
			document.querySelector("#probe-box")?.remove();
			const box = document.createElement("div");
			box.id = "probe-box";
			box.style.cssText = "height:200px;overflow-y:auto;overscroll-behavior:${behavior};background:rgba(0,0,0,.04)";
			const fill = document.createElement("div");
			fill.style.height = ${tall ? "600" : "80"} + "px";
			box.appendChild(fill);
			// 插在最前面：放到末尾的话，外层停在顶部时这盒子还在视口外，滚轮派过去等于派到了窗口外面。
			window.__outer.firstElementChild.prepend(box);
			box.scrollTop = box.scrollHeight;
			const r = box.getBoundingClientRect();
			return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), room: box.scrollHeight - box.clientHeight };
		})()`);

	/**
	 * 在一个点上真滚一下，返回外层被带动了多少。
	 *
	 * 先把指针挪过去再滚：滚轮是发给指针底下那个元素的，没有 `mouseMoved` 打头，第一次跑四种组合
	 * 全是 0px——连本该畅通的 `auto` 也不动，那不是结论，是没问到。
	 */
	const wheelAt = async (x: number, y: number) => {
		const before = await app.evaluate<number>(`window.__outer.scrollTop`);
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, pointerType: "mouse" });
		await settle(60);
		for (let i = 0; i < 3; i++) {
			await app.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: 120, pointerType: "mouse" });
			await settle(90);
		}
		await settle(300);
		const after = await app.evaluate<number>(`window.__outer.scrollTop`);
		return after - before;
	};

	/*
	 * 先问一句「这根滚轮管不管用」。
	 *
	 * 不放任何盒子，直接在外层身上滚。这一条不过，后面四种组合量到的 0px 说明不了任何事。
	 */
	await app.evaluate(`(() => { window.__outer.scrollTop = 0; return true; })()`);
	const bare = await app.evaluate<{ x: number; y: number }>(`(() => {
		const r = window.__outer.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	const baseline = await wheelAt(bare.x, bare.y);
	check("滚轮本身管用（外层空白处）", baseline > 20, `外层动了 ${baseline.toFixed(0)}px`);

	const rows: { behavior: string; tall: boolean; room: number; moved: number }[] = [];
	for (const behavior of ["contain", "auto"]) {
		for (const tall of [false, true]) {
			await app.evaluate(`(() => { window.__outer.scrollTop = 0; return true; })()`);
			await settle(200);
			const box = await plant(behavior, tall);
			const moved = await wheelAt(box.x, box.y);
			rows.push({ behavior, tall, room: box.room, moved });
		}
	}
	await app.evaluate(`(() => { document.querySelector("#probe-box")?.remove(); return true; })()`);

	process.stdout.write(`\n内层盒子      自己可滚   滚轮落在它上面时，外层动了多少\n`);
	for (const r of rows) {
		process.stdout.write(`  ${r.behavior.padEnd(8)}  ${String(r.room).padStart(4)}px    ${r.moved.toFixed(0)}px\n`);
	}

	const stuckWhenIdle = rows.find((r) => r.behavior === "contain" && !r.tall);
	const freeWhenIdle = rows.find((r) => r.behavior === "auto" && !r.tall);
	check(
		"滚不动的内层盒子挂着 contain，就把滚轮吞了——这正是现场",
		stuckWhenIdle !== undefined && Math.abs(stuckWhenIdle.moved) < 1,
		`外层动了 ${stuckWhenIdle?.moved.toFixed(0)}px`,
	);
	check(
		"同一个盒子换成 auto，滚轮照常传出去",
		freeWhenIdle !== undefined && freeWhenIdle.moved > 20,
		`外层动了 ${freeWhenIdle?.moved.toFixed(0)}px`,
	);

	/*
	 * 修完之后，真实的那些面是什么样。
	 *
	 * 上面四行量的是 CSS 本身的脾气，这一段问的是「我们的 `Scroller` 现在挂的是哪一个」：滚不动的
	 * 面一律该是 `auto`，否则鼠标停上去整页就滚不动——那正是这一趟要修的毛病。
	 */
	const views = await app.evaluate<{ scrollable: number; behavior: string; cls: string }[]>(`(() => {
		return [...document.querySelectorAll("[data-ly-settings] .ly-scroll-view")].map((v) => ({
			scrollable: v.scrollHeight - v.clientHeight,
			behavior: getComputedStyle(v).overscrollBehaviorY,
			cls: (v.className.match(/overscroll-\\w+/) || ["(没有)"])[0],
		}));
	})()`);
	process.stdout.write(`\n设置页上此刻的那些滚动面：\n`);
	for (const v of views) {
		process.stdout.write(`  可滚 ${String(v.scrollable).padStart(5)}px   ${v.behavior.padEnd(8)} ${v.cls}\n`);
	}
	const idleStuck = views.filter((v) => v.scrollable <= 1 && v.behavior === "contain");
	check(
		"滚不动的面一律放行滚轮",
		idleStuck.length === 0,
		idleStuck.length ? `还有 ${idleStuck.length} 面滚不动却挂着 contain` : `${views.filter((v) => v.scrollable <= 1).length} 面滚不动，都是 auto`,
	);

	const stuckAtEnd = rows.find((r) => r.behavior === "contain" && r.tall);
	process.stdout.write(
		`\n另一半（内层可滚、已经滚到底）：contain 下外层动了 ${stuckAtEnd?.moved.toFixed(0)}px——` +
			`拦在这里是 contain 该做的事，不是毛病。\n`,
	);
} finally {
	await app.stop();
}

process.stdout.write(`\n${failures === 0 ? "全部通过" : `${failures} 项未通过`}\n`);
process.exit(failures === 0 ? 0 : 1);
