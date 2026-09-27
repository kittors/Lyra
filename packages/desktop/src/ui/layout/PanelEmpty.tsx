import type { LucideIcon } from "lucide-react";

/**
 * The middle of an empty panel body.
 *
 * Centred icon, name, one sentence saying what this is. The same shape for every kind of tab,
 * so the panel reads as one thing with several contents rather than as several unrelated
 * screens that happen to share a frame.
 *
 * Its own file because both the panel shell and the things inside it need it, and having the
 * shell export it made the two import each other.
 */
export function PanelEmpty({
	icon: Icon,
	art,
	title,
	children,
}: {
	icon: LucideIcon;
	/** 画在图标的位置上、比一枚线性图标更能说明这里该有什么的东西——子智能体面板放的是几张睡着的脸。 */
	art?: React.ReactNode;
	title: string;
	/** 可省：有些空状态的标题已经把话说完了，底下再补一句就是在解释一个不需要解释的东西。 */
	children?: React.ReactNode;
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col items-center justify-center px-7 pb-6 text-center">
			{art ?? <Icon size={30} strokeWidth={1.35} className="text-ink-faint" />}
			<h2 className="mt-3.5 text-title font-medium text-ink">{title}</h2>
			{children !== undefined && <p className="mt-2 max-w-[290px] text-label leading-relaxed text-ink-muted">{children}</p>}
		</div>
	);
}
