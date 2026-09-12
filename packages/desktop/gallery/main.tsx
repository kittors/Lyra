/**
 * The components, on their own.
 *
 * Not Storybook. This is an extra entry point in the existing Vite config, built only when
 * `LYRA_GALLERY` is set, so it costs the shipped application nothing and needs no second toolchain.
 *
 * It answers a question the tests cannot: what does this actually look like. `test/ui/` asserts
 * that a danger button has `bg-danger` — true, and it says nothing about whether the red reads as
 * dangerous against a card, or whether two sizes of button look deliberate side by side.
 *
 * Every variant on one page, in both themes, is also how you find the combination nobody tried:
 * a loading button inside a disabled row, an icon button next to a text one.
 */

import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { Button } from "../src/ui/primitives/Button.tsx";
import { IconButton } from "../src/ui/primitives/IconButton.tsx";
import { Text } from "../src/ui/primitives/Text.tsx";
import { Badge, Segmented, Toggle } from "../src/features/settings/controls.tsx";
import { BreatheLoader, Spinner } from "../src/ui/motion/loaders.tsx";
import { installTooltips } from "../src/ui/overlay/tooltip.ts";
import "../src/styles.css";

installTooltips();

function Row({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="border-b border-line px-6 py-5">
			<Text as="h2" size="caption" tone="faint" className="mb-3 block uppercase tracking-wide">
				{title}
			</Text>
			<div className="flex flex-wrap items-center gap-3">{children}</div>
		</section>
	);
}

const ICON = (
	<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
		<path d="M5 12h14M12 5v14" />
	</svg>
);

function Gallery() {
	const [dark, setDark] = useState(true);
	const [on, setOn] = useState(false);
	const [seg, setSeg] = useState("system");

	// 主题切换直接改 `<html>`，和应用里的做法一样——画廊要和真实环境用同一条路径。
	document.documentElement.classList.toggle("dark", dark);
	document.documentElement.classList.toggle("light", !dark);

	return (
		<div className="min-h-screen bg-shell text-ink">
			<header className="flex items-center justify-between border-b border-line px-6 py-4">
				<Text size="title" className="font-semibold">
					Lyra 组件
				</Text>
				<Button variant="ghost" size="sm" onClick={() => setDark((d) => !d)}>
					{dark ? "浅色" : "深色"}
				</Button>
			</header>

			{/*
			 * 全应用唯一的「正在忙」，摆成它实际出现过的那几个尺寸。
			 *
			 * 这一行要回答的是断言问不出来的那个问题：11px 的时候八条线还分得开，还是已经糊成一个
			 * 灰点。`test/ui/spinner.test.ts` 能证明八条线都在、相位是对的——那跟看不看得清是两件事。
			 */}
			<Row title="Spinner — 应用里用到的尺寸。11px 上八条线还该分得开">
				{[11, 12, 13, 14, 16, 20].map((size) => (
					<span key={size} className="flex flex-col items-center gap-1.5">
						<Spinner size={size} />
						<Text size="caption" tone="faint">{size}</Text>
					</span>
				))}
			</Row>

			{/*
			 * 两个记号并排，看的是它们该不该是两个。
			 *
			 * 射线是通用的「正在忙」；呼吸只给侧栏会话行，因为那一列可能同时好几行在跑，而它还要
			 * 用来读标题。并排放着，也是在提醒下一个想「统一」的人：左边这个已经被删过一次。
			 */}
			<Row title="Spinner / BreatheLoader — 通用的那个，和只给侧栏会话行的那个">
				<span className="flex flex-col items-center gap-1.5">
					<Spinner size={14} />
					<Text size="caption" tone="faint">射线</Text>
				</span>
				<span className="flex flex-col items-center gap-1.5">
					<BreatheLoader size={12} />
					<Text size="caption" tone="faint">呼吸</Text>
				</span>
			</Row>

			<Row title="Spinner — 颜色跟着周围走">
				<span className="text-ink"><Spinner size={16} /></span>
				<span className="text-ink-muted"><Spinner size={16} /></span>
				<span className="text-ink-faint"><Spinner size={16} /></span>
				<Spinner size={16} className="text-accent" />
				<Spinner size={16} className="text-amber-500" />
				<span className="flex h-7 items-center gap-1.5 rounded-lg bg-ink px-3 text-detail text-shell">
					<Spinner size={12} />
					深底上
				</span>
			</Row>

			<Row title="Button — 四种变体">
				<Button variant="primary">主要</Button>
				<Button variant="ghost">次要</Button>
				<Button variant="subtle">轻</Button>
				<Button variant="danger">危险</Button>
			</Row>

			<Row title="Button — 两种高度，并排看是否成对">
				<Button size="md">32px</Button>
				<Button size="sm">26px</Button>
				<Button size="md" variant="primary">
					32px
				</Button>
				<Button size="sm" variant="primary">
					26px
				</Button>
			</Row>

			<Row title="Button — 状态。忙碌时宽度不该变">
				<Button>正常</Button>
				<Button disabled>禁用</Button>
				<Button loading>推送</Button>
				<Button variant="primary" loading>
					推送
				</Button>
			</Row>

			<Row title="Button — 图标。无文字时是方的，一排下来等宽">
				<Button icon={ICON} label="新建" />
				<Button icon={ICON} label="新建" size="sm" />
				<Button icon={ICON}>带文字</Button>
				<Button icon={ICON} variant="danger" label="删除" />
			</Row>

			<Row title="IconButton — 悬停看提示">
				<IconButton label="搜索" icon={ICON} onClick={() => {}} />
				<IconButton label="已选中" icon={ICON} active onClick={() => {}} />
				<IconButton label="强调" icon={ICON} emphasis onClick={() => {}} />
				<IconButton label="危险" icon={ICON} tone="danger" onClick={() => {}} />
				<IconButton label="有计数" icon={ICON} badge={3} onClick={() => {}} />
				<IconButton label="禁用" icon={ICON} disabled onClick={() => {}} />
			</Row>

			<Row title="Toggle / Segmented">
				<Toggle checked={on} onChange={setOn} />
				<Segmented
					value={seg}
					onChange={setSeg}
					options={[
						{ value: "system", label: "跟随系统" },
						{ value: "light", label: "浅色" },
						{ value: "dark", label: "深色" },
					]}
				/>
			</Row>

			<Row title="Badge">
				<Badge tone="ok">已安装</Badge>
				<Badge tone="muted">未启用</Badge>
				<Badge tone="danger">失败</Badge>
				<Badge tone="accent">新</Badge>
			</Row>

			<Row title="Text — 七级字阶，看相邻两级是否分得开">
				<div className="flex flex-col gap-1">
					{(["display", "heading", "title", "body", "label", "detail", "caption"] as const).map((size) => (
						<Text key={size} size={size}>
							{size} — 中文与 latin 混排 Aa
						</Text>
					))}
				</div>
			</Row>
		</div>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<Gallery />
	</StrictMode>,
);
