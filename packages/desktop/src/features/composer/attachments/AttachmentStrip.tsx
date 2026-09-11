/**
 * 带了哪几个文件，画成一排。
 *
 * 输入框上方和已发出的气泡外面共用这一个。两边从前各画各的，于是同一份文件在两处长得不一样：
 * 输入框里是一颗胶囊，气泡里是嵌在句子中间的一段行内文字。图片更糟——气泡外有它的缩略图，气泡
 * 里还有一遍它的文件名，一个是像素一个是紫色图标，两遍看不出是同一个东西。一个文件说一次，那
 * 就只能有一个地方画它。
 *
 * 分两组，不是混在一排。图片和文件本来就是两种东西：一个能看，一个只能认名字，所以一个是方块
 * 一个是长条。从前它们按拖进来的次序混在同一个 `flex-wrap` 里，68px 高的缩略图挨着 28px 高的
 * 胶囊，换行之后右边空一大块、左下角孤零零剩一个——高矮不齐是没法靠调间距救回来的，只能不让
 * 它们站在同一行上。各自成组之后，组内尺寸天生一致，摆几个都是齐的。
 */

import { X } from "lucide-react";
import type { MouseEvent } from "react";

import { translate } from "../../../i18n/translate.ts";
import { FileKindIcon } from "./FileKindIcon.tsx";
import type { FileKind } from "./file-kind.ts";

export interface StripFile {
	key: string;
	name: string;
	kind: FileKind;
	/** 看得见的那种才有。有它就画缩略图，没有就画门类图标加名字。 */
	src?: string;
	/** 悬停时多说的那一行，通常是「文件名 + 门类」。 */
	tip?: string;
}

/**
 * 取下那一个的按钮。
 *
 * 画在格子**里面**，不再是 `-top-1.5 -right-1.5` 浮到外面去。溢出的那一版在单行时看不出问题，
 * 一换行就露馅：行距只有 8px，下一行的叉正好压在上一行缩略图的下缘上。
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

export function AttachmentStrip({
	files,
	align = "start",
	thumbnail = 64,
	onOpen,
	onRemove,
	className = "",
}: {
	files: StripFile[];
	align?: "start" | "end";
	/** 缩略图的边长。输入框上方紧凑些，气泡外要能认出是哪一张。 */
	thumbnail?: number;
	/**
	 * 点开第 n 张图。
	 *
	 * 序号在**能看的那些**里数，不在全部附件里数——混着数就会点开另一张图，而这一类错要等到
	 * 附件里同时有图和文档时才出现。
	 */
	onOpen?: (imageIndex: number, event: MouseEvent<HTMLElement>) => void;
	onRemove?: (file: StripFile) => void;
	className?: string;
}) {
	if (files.length === 0) return null;

	const images = files.filter((file) => file.src);
	const documents = files.filter((file) => !file.src);
	const justify = align === "end" ? "justify-end" : "justify-start";

	return (
		<div
			/* 输入框上方和气泡外面是同一排东西，探针和测试按这个找它，不必去猜第几层 div。 */
			data-ly-attachments=""
			className={`flex flex-col gap-2 ${align === "end" ? "items-end" : "items-start"} ${className}`}
		>
			{images.length > 0 && (
				<div className={`flex flex-wrap gap-2 ${justify}`}>
					{images.map((file, index) => (
						<div key={file.key} className="group/thumb relative shrink-0">
							<button
								type="button"
								data-ly-tip={file.tip}
								/* 转录里的老消息只有图片块、没有附件元数据，那时连名字都没有。 */
								aria-label={
									file.name
										? translate("subAgent.previewOne", { name: file.name })
										: translate("userMessage.previewImage")
								}
								disabled={!onOpen}
								onClick={onOpen ? (event) => onOpen(index, event) : undefined}
								style={{ width: thumbnail, height: thumbnail }}
								className="block overflow-hidden rounded-lg border border-line transition-[opacity,transform] duration-[var(--ly-t-quick)] enabled:hover:opacity-85 enabled:active:scale-[0.97]"
							>
								{/* `cover`：一排等大的方块读起来是一组东西。按各自比例留黑边的缩略图读起来
								    像是排版放弃了。 */}
								<img src={file.src} alt={file.name} className="h-full w-full object-cover" />
							</button>
							{onRemove && (
								/*
								 * 鼠标挪上来才现身。
								 *
								 * 常驻的那一版，一排缩略图上钉着一排叉——最显眼的东西成了「删掉我」，而这排东西是拿来看的。
								 * 要删总得先把鼠标移过去，那一刻它再出现也不迟。
								 *
								 * `group-has-[:focus-visible]` 是键盘那一路：只挂 hover 的话，用 Tab 走到这个按钮上时它仍然
								 * 是透明的，人按下去也不知道自己按的是什么。
								 */
								<div
									data-ly-hover-reveal
									className="absolute top-1 right-1 rounded-full border border-line bg-float/90 opacity-0 transition-opacity duration-[var(--ly-t-quick)] group-hover/thumb:opacity-100 group-has-[:focus-visible]/thumb:opacity-100"
								>
									<Remove name={file.name} onClick={() => onRemove(file)} />
								</div>
							)}
						</div>
					))}
				</div>
			)}

			{documents.length > 0 && (
				<div className={`flex flex-wrap gap-1.5 ${justify}`}>
					{documents.map((file) => (
						<div
							key={file.key}
							data-ly-tip={file.tip}
							className={`flex h-8 max-w-[240px] items-center gap-1.5 rounded-lg border border-line-soft bg-card pl-2 text-caption ${onRemove ? "pr-1" : "pr-2.5"}`}
						>
							<FileKindIcon kind={file.kind} size={14} />
							<span className="min-w-0 truncate text-ink">{file.name}</span>
							{onRemove && <Remove name={file.name} onClick={() => onRemove(file)} />}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
