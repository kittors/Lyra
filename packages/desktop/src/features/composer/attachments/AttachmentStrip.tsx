/**
 * 带了哪几个文件，画成一排。
 *
 * 输入框上方和已发出的气泡外面共用这一个。两边从前各画各的，于是同一份文件在两处长得不一样：
 * 输入框里是一颗胶囊，气泡里是嵌在句子中间的一段行内文字。图片更糟——气泡外有它的缩略图，气泡
 * 里还有一遍它的文件名，一个是像素一个是紫色图标，两遍看不出是同一个东西。一个文件说一次，那
 * 就只能有一个地方画它。
 *
 * 一排，不是两组。图片和文档从前各排各的，谁也不知道另一边有几个；现在它们在同一排上，按人放进
 * 去的先后。这一点顺带修好了另一件事：发给模型的 `Attachment 2 of 5` 数的就是这个先后（见
 * `attachment-placeholders.ts`），而分了组之后，屏幕上的第二个和提示词里的第二个不是同一份。
 *
 * 齐的是中线，不是高度。这一版一度把文档也拉成和图片一样的方块，理由是「一样大才整齐」——画出来
 * 不是：一个 64 见方的格子里只有一个图标和一个文件名，空得发慌，六个这样的格子在气泡里占掉大半
 * 屏；而名字被挤成两行之后，单独画出来的扩展名角标又和第二行文字错开，怎么摆都别扭。
 *
 * 文件名是横向的文本，横条才是它的形状：同样的宽度，一行放得下二十个字符，方块里两行也只放得下
 * 十个。所以图片是方块、文档是横条，靠 `align-items: center` 在同一排上对齐中线——分组当初要躲的
 * 是「高矮不齐挤在一起」，而那件事靠的是对齐，不是靠把矮的那个拉高。
 */

import { MoreHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { MouseEvent } from "react";

import { AttachmentMenu } from "./AttachmentMenu.tsx";
import { FileKindIcon } from "./FileKindIcon.tsx";
import { displayName, isPlaceholderName, nameParts } from "./display.ts";
import { KIND_LABEL, type FileKind } from "./file-kind.ts";
import { translate } from "../../../i18n/translate.ts";
import { useAttachmentActions } from "./actions.ts";
import { useContextMenu } from "../../../ui/overlay/ContextMenu.tsx";
import { useI18n } from "../../../i18n/index.ts";

export interface StripFile {
	key: string;
	name: string;
	kind: FileKind;
	/** 看得见的那种才有。有它就画缩略图，没有就画门类图标加名字。 */
	src?: string;
	/**
	 * 磁盘上的位置，附件真的来自一个文件时才有。
	 *
	 * 粘贴进来的截图没有：那是内存里的一团像素，名字是我们替它编的。已发出的老消息也没有——那时
	 * 这个字段还不存在。两种都一样处理：能做的事少几件，而不是多几件做不成的。
	 */
	path?: string;
	/** 悬停时多说的那一行，通常是「文件名 + 门类」。 */
	tip?: string;
	/**
	 * 界面上叫什么，调用方已经算好的话。
	 *
	 * 输入框那边必须自己算：正文里那枚标记写的就是这个名字，两边差一个字就配不上了。气泡那边不
	 * 传，由这里按同一套规则算出来——同样的输入得同样的结果，那正是 `displayName` 是个纯函数的
	 * 原因。
	 */
	label?: string;
}

/**
 * 取下那一个的按钮。
 *
 * 浮在格子右上角上，一半探到外面——这是这类缩略图通行的位置，也是人第一眼会去找它的地方。画进格
 * 子里面时它压着图本身，既挡内容又不像个「取下」的手柄。
 *
 * 这里一度因为「换行之后，下一行的叉压在上一行缩略图的下缘上」被收回格子内部。那其实是行距的问
 * 题，不是位置的问题：叉往上探出 8px，而当时纵向行距只有 8px，一点余量都不剩。现在纵向给到
 * 12px（横向仍是 8px），空出来的 4px 就是余量。
 *
 * 单行横滚那一版另有一处要还：会滚的容器把探到外面的半个叉裁掉。所以轨道自己带内边距，再用同样
 * 大小的负外边距把位置还原——裁掉的是内边距以外的东西，而叉正落在内边距里面。见 `.ly-attachments`。
 */
function Remove({ name, onClick }: { name: string; onClick: () => void }) {
	const label = translate("composer.removeAttachment", { name });
	return (
		<button
			type="button"
			data-ly-tip={label}
			aria-label={label}
			onClick={onClick}
			className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-card-hover hover:text-ink"
		>
			<X size={11} strokeWidth={2.2} />
		</button>
	);
}

/**
 * 这一格还能做什么，都在这儿。
 *
 * 画在格子里面的右下角，不像叉那样探出去。两个都探出去的话，一个 64px 的方块上挂着两个悬在角上
 * 的圆，格子本身反倒成了它们的背景；而这一个按下去是「展开一张单子」，本来就该长在它所属的那块
 * 东西上。
 *
 * 有它，是因为右键菜单没人找得到。这一排上能做的事有一半只存在于右键里——打开、在访达中显示、
 * 复制路径——而右键在一个看起来像缩略图的方块上不是任何人的第一反应。
 */
function More({ name, onClick }: { name: string; onClick: (event: MouseEvent<HTMLElement>) => void }) {
	const label = translate("attachment.more");
	return (
		<button
			type="button"
			data-ly-tip={`${label} · ${name}`}
			aria-label={`${label} · ${name}`}
			onClick={onClick}
			className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-line bg-float text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
		>
			<MoreHorizontal size={12} strokeWidth={2} />
		</button>
	);
}

export function AttachmentStrip({
	files,
	align = "start",
	thumbnail = 64,
	layout = "wrap",
	onOpen,
	onPreviewFile,
	onRemove,
	className = "",
}: {
	files: StripFile[];
	align?: "start" | "end";
	/** 格子的高度，也是图片的边长。输入框上方紧凑些，气泡外要能认出是哪一张。 */
	thumbnail?: number;
	/**
	 * 一行，还是几行。
	 *
	 * 输入框上方是 `row`：附件区独占一行，多了就两头化开、横着滚。那一块地方是拿来打字的，一排
	 * 附件换到第三行时，被挤出屏幕的是输入框自己。
	 *
	 * 气泡外面是 `wrap`：那一条消息已经发出去了，它带了九个文件就该看见九个，下面没有什么在等着
	 * 被挤走。滚动在那里还会藏东西——翻旧消息的人不会想到要去横着拨一下。
	 */
	layout?: "wrap" | "row";
	/**
	 * 点开第 n 张图。
	 *
	 * 序号在**能看的那些**里数，不在全部附件里数——混着数就会点开另一张图，而这一类错要等到
	 * 附件里同时有图和文档时才出现。
	 */
	onOpen?: (imageIndex: number, event: MouseEvent<HTMLElement>) => void;
	/** 在应用里打开一个不是图片的附件。只对项目里的文件生效——面板读不到项目外的东西。 */
	onPreviewFile?: (file: StripFile) => void;
	onRemove?: (file: StripFile) => void;
	className?: string;
}) {
	const { t } = useI18n();
	const actions = useAttachmentActions();
	const menu = useContextMenu<string>();
	const track = useRef<HTMLDivElement>(null);
	/*
	 * 每一格那颗主按钮，按 key 记着。
	 *
	 * 菜单里的「在 Lyra 中打开」最终走的就是它：图片查看器是从一个矩形长出来的，而那个矩形只有真
	 * 的点在按钮上时才拿得到（`openFromEvent` 读的是事件的 `currentTarget`）。菜单里没有这样一次
	 * 点击，所以替人点一下它——同一段动画，同一条代码路径。
	 */
	const bodies = useRef(new Map<string, HTMLButtonElement | null>());
	const count = files.length;

	/*
	 * 一份附件在这一排里的全部身份：叫什么、排第几、能被怎么处置。
	 *
	 * 一次算齐而不是边画边算。序号是有状态的（同门类里第几个、能看的里面第几张），在 JSX 里边
	 * 渲染边累加，读的人得先在心里跑一遍循环才知道某个数是什么。
	 */
	const regionShot = t("composer.regionShot");
	const tiles = useMemo(() => {
		const kindSeen = new Map<FileKind, number>();
		let imageAt = -1;
		return files.map((file) => {
			const kindIndex = (kindSeen.get(file.kind) ?? 0) + 1;
			kindSeen.set(file.kind, kindIndex);
			if (file.src) imageAt += 1;
			/*
			 * 格子上是全名。
			 *
			 * `label` 是正文里那枚标记写的短名（「表格 2」），只在文件本来就没有像样名字时顶上——
			 * 一张粘贴进来的图，它的 `name` 是剪贴板编的 `image.png`。
			 */
			const label = isPlaceholderName(file.name, regionShot)
				? (file.label ?? displayName({ name: file.name, kindLabel: t(KIND_LABEL[file.kind]), kindIndex }, regionShot))
				: file.name;
			const { onDisk, inProject } = actions.abilities(file.path);
			return {
				file,
				label,
				parts: nameParts(label),
				imageIndex: imageAt,
				/*
				 * 点一下能不能看到东西。
				 *
				 * 图片永远能——像素就在手上，不需要磁盘上还有那个文件。文档要进右边的面板，而面板
				 * 读不到项目外的东西（`files.read` 要过 `resolveReadablePath`），所以项目外的文档
				 * 点一下什么也不会发生，它的「打开」只能是交给外部应用。
				 */
				canPreview: file.src ? Boolean(onOpen) : Boolean(onPreviewFile) && inProject,
				canOpenExternal: onDisk,
			};
		});
	}, [files, t, regionShot, actions, onOpen, onPreviewFile]);

	/*
	 * 两头化不化开，是量出来的。
	 *
	 * 没溢出就不该有任何渐隐：两个附件排在左边、右边空着一半，却在中间凭空糊掉一块。所以两侧各
	 * 自问一次「这个方向还有没有东西」，答案写成属性，深浅由 CSS 说了算。
	 */
	const measure = useCallback(() => {
		const el = track.current;
		if (!el) return;
		const room = el.scrollWidth - el.clientWidth;
		el.toggleAttribute("data-fade-start", el.scrollLeft > 1);
		el.toggleAttribute("data-fade-end", room > 1 && el.scrollLeft < room - 1);
	}, []);

	useLayoutEffect(measure, [measure, count, layout, thumbnail]);

	useEffect(() => {
		const el = track.current;
		if (!el || layout !== "row") return;

		const observer = new ResizeObserver(measure);
		observer.observe(el);
		el.addEventListener("scroll", measure, { passive: true });

		/*
		 * 竖着的滚轮也要能拨动这一排。
		 *
		 * 触控板天生能横着推，而一只普通鼠标只有一个竖轮子——没有这一段，一排滚得动的附件对用鼠标
		 * 的人就是滚不动的。只在真的横向溢出、且这一下确实是竖向意图时才接管，否则会把页面自己的
		 * 滚动一起吃掉。
		 *
		 * 自己挂监听，不用 `onWheel`：React 的合成事件挂在根上且是被动的，里面的 `preventDefault`
		 * 不起作用，页面会在横滚的同时照样往下走。
		 */
		const wheel = (event: WheelEvent) => {
			if (el.scrollWidth <= el.clientWidth) return;
			if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
			el.scrollLeft += event.deltaY;
			event.preventDefault();
		};
		el.addEventListener("wheel", wheel, { passive: false });

		return () => {
			observer.disconnect();
			el.removeEventListener("scroll", measure);
			el.removeEventListener("wheel", wheel);
		};
	}, [measure, layout]);

	/*
	 * 刚放进来的那一个要被看见。
	 *
	 * 新附件排在最右，而那里往往已经在可视范围之外：拖进第七个文件，屏幕上什么都没发生。
	 */
	const known = useRef(count);
	useEffect(() => {
		const el = track.current;
		if (el && layout === "row" && count > known.current) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
		known.current = count;
	}, [count, layout]);

	if (tiles.length === 0) return null;

	const picked = tiles.find((tile) => tile.file.key === menu.target);

	return (
		<div
			/* 输入框上方和气泡外面是同一排东西，探针和测试按这个找它，不必去猜第几层 div。 */
			data-ly-attachments=""
			data-ly-layout={layout}
			className={`ly-attachments ${align === "end" ? "items-end" : "items-start"} ${className}`}
		>
			<div
				ref={track}
				data-ly-attachments-track=""
				className={`ly-attachments-track ${layout === "row" ? "ly-attachments-row" : "flex-wrap"} ${align === "end" ? "justify-end" : "justify-start"}`}
			>
				{tiles.map(({ file, label, parts, imageIndex, canPreview, canOpenExternal }) => (
					<div
						key={file.key}
						data-ly-attachment={file.key}
						/* 图片和横条挂的控件位置不同，CSS 按这个分。 */
						data-ly-shape={file.src ? "image" : "file"}
						className="ly-attachment group/tile"
						onContextMenu={(event) => menu.show(event, file.key)}
					>
						<button
							type="button"
							ref={(node) => {
								bodies.current.set(file.key, node);
							}}
							/*
							 * 悬停时补一句这一格点得动点不动。
							 *
							 * 由这里补而不是由调用方写：能不能预览是这个组件刚刚算出来的，让两个调用方
							 * 各自再算一遍，迟早有一个和实际行为对不上。一个点上去毫无反应的格子，看起
							 * 来就是坏的。
							 */
							data-ly-tip={[file.tip, !canPreview && canOpenExternal ? t("attachment.openHint") : null]
								.filter(Boolean)
								.join("\n")}
							aria-label={label}
							/*
							 * 点一下会发生什么，取决于这一份能做到什么。图片有查看器；项目里的文件进得
							 * 了面板；项目外的文件两样都不行，那一下就留给双击——交给外部应用是它唯一
							 * 的「打开」，而那件事不该由一颗看起来像是要预览的按钮替人决定。
							 *
							 * 单击和双击不会同时挂在一颗按钮上：能预览的只挂单击，不能预览的只挂双击。
							 * 两个都挂的话，一次双击会先开一个面板再启动一个应用，两件事都发生了。
							 */
							disabled={!canPreview && !canOpenExternal}
							onClick={
								canPreview
									? file.src && onOpen
										? (event) => onOpen(imageIndex, event)
										: onPreviewFile
											? () => onPreviewFile(file)
											: undefined
									: undefined
							}
							onDoubleClick={
								!canPreview && canOpenExternal
									? () => actions.openExternal({ name: label, ...(file.path ? { path: file.path } : {}) })
									: undefined
							}
							className="ly-attachment-body"
							{...(file.src ? { style: { width: thumbnail, height: thumbnail } } : {})}
						>
							{file.src ? (
								/* `cover`：一排等大的方块读起来是一组东西。按各自比例留黑边的缩略图读起来
								    像是排版放弃了。 */
								<img src={file.src} alt={label} className="h-full w-full object-cover" />
							) : (
								<span className="flex h-full items-center gap-1.5">
									<FileKindIcon kind={file.kind} size={14} />
									{/*
									 * 名字截中间，扩展名不参与。
									 *
									 * 省略号落在末尾的话，被吃掉的正好是 `.xlsx`——一排六个文件于是既看不出是
									 * 哪一个，也看不出是什么。拆成两段之后，省的是中间那截：
									 * 「陈列道具导入模板(花园…).xlsx」。见 `nameParts`。
									 *
									 * 两段之间不留空隙：它们是同一个名字，中间多 6px 就读成了两样东西
									 * （「录屏2026-09-11 17.37.06 .mov」）。间距只在图标和名字之间。
									 */}
									<span className="flex min-w-0 items-baseline">
										<span className="ly-attachment-name">{parts.stem}</span>
										{parts.ext && <span className="shrink-0 text-ink-muted">.{parts.ext}</span>}
									</span>
								</span>
							)}
						</button>

						{onRemove && (
							/*
							 * 鼠标挪上来才现身。
							 *
							 * 常驻的那一版，一排缩略图上钉着一排叉——最显眼的东西成了「删掉我」，而这排东西是
							 * 拿来看的。要删总得先把鼠标移过去，那一刻它再出现也不迟。
							 *
							 * 键盘和触屏那两路在 `.ly-attachment-control` 里：焦点落进来时要看得见，而没有悬停
							 * 可言的设备上两颗都常驻。
							 */
							<div
								data-ly-hover-reveal
								className="ly-attachment-control absolute -top-2 -right-2 rounded-full border border-line bg-float"
							>
								<Remove name={label} onClick={() => onRemove(file)} />
							</div>
						)}

						<div data-ly-hover-reveal className="ly-attachment-control ly-attachment-more absolute right-1 bottom-1">
							<More name={label} onClick={(event) => menu.show(event, file.key)} />
						</div>
					</div>
				))}
			</div>

			<AttachmentMenu
				anchor={menu.anchor}
				file={
					picked
						? {
								name: picked.label,
								...(picked.file.path ? { path: picked.file.path } : {}),
								...(picked.canPreview ? { onPreview: () => bodies.current.get(picked.file.key)?.click() } : {}),
							}
						: null
				}
				onClose={menu.close}
				{...(onRemove && picked ? { onRemove: () => onRemove(picked.file) } : {})}
			/>
		</div>
	);
}
