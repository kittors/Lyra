/**
 * 市场的分类：名字和它们在货架上的先后。
 *
 * 分类是索引里的一个字符串，由写条目的人填——默认市场（Lyra-Plugins 的 sources.json）用的是这
 * 一组中文词。放在契约包里而不是窗口里，是因为「有哪些分类、谁在前」是市场的约定：平台的网页、
 * 桌面端的货架、同步脚本的校验说的应该是同一组词。
 *
 * 顺序不是字母序——「办公」排在「开发」前面不是任何人会选的顺序。大致是「打开一个写代码的 agent
 * 的市场时，最常找的是什么」。不在这张表里的分类排在后面，按条目多少。
 */
export const CATEGORY_ORDER = [
	"开发",
	"工作流",
	"浏览器",
	"搜索",
	"文档",
	"数据",
	"设计",
	"办公",
	"协作",
	"思考",
	"科研",
	"云与运维",
	"安全",
	"媒体",
	"本机",
] as const;

/**
 * English names registries use for the shelves above, lower-cased.
 *
 * Registries are written by different people. Ours says 开发; a Claude Code marketplace added as a
 * source says "development" — and a catalogue showing 开发 and development as neighbouring chips is
 * showing one shelf twice under two names, one of them in the wrong language.
 */
const ALIASES: Record<string, (typeof CATEGORY_ORDER)[number]> = {
	development: "开发",
	dev: "开发",
	coding: "开发",
	programming: "开发",
	"developer tools": "开发",
	devtools: "开发",
	workflow: "工作流",
	workflows: "工作流",
	engineering: "工作流",
	browser: "浏览器",
	browsers: "浏览器",
	"browser automation": "浏览器",
	search: "搜索",
	"web search": "搜索",
	docs: "文档",
	documentation: "文档",
	data: "数据",
	database: "数据",
	databases: "数据",
	analytics: "数据",
	design: "设计",
	"ui/ux": "设计",
	productivity: "办公",
	office: "办公",
	collaboration: "协作",
	communication: "协作",
	"project management": "协作",
	thinking: "思考",
	reasoning: "思考",
	research: "科研",
	science: "科研",
	academic: "科研",
	cloud: "云与运维",
	devops: "云与运维",
	infrastructure: "云与运维",
	monitoring: "云与运维",
	security: "安全",
	media: "媒体",
	content: "媒体",
	local: "本机",
	system: "本机",
};

/** The shelf a category belongs on: one of `CATEGORY_ORDER` when it is an English name for one, else as written. */
export function canonicalCategory(raw: string | undefined): string | undefined {
	const trimmed = raw?.trim();
	if (!trimmed) return undefined;
	return ALIASES[trimmed.toLowerCase()] ?? trimmed;
}
