/**
 * Every risk rule's code, and the sentence the rules themselves say it with.
 *
 * A rule that fires reports its code; the host says it in the interface's language by looking the
 * code up in its own catalogues (`risk.<code>` in `packages/desktop/src/i18n/messages`). The
 * sentence here is for everything that shows the finding as it is: the session log, a refusal
 * handed back to the model, a caller with no catalogue of its own.
 *
 * It used to be the only form the finding took, and the approval gate wrote it into the top of the
 * card's text — so every language got the Chinese sentence. Keeping the code beside it is what lets
 * the card change with the window's language, and keeps core free of any host's translations.
 *
 * `{name}` stands for a value the sentence needs, passed along as the verdict's `params`.
 */
export const RISK_REASONS = {
	// Commands.
	"recursive-delete": "递归删除目录",
	"download-and-run": "下载并直接执行脚本",
	"run-as-admin": "以管理员身份执行",
	"force-delete-glob": "强制删除通配匹配的文件",
	"delete-root-or-home": "删除根目录或主目录",
	"force-push": "强制推送会覆盖远程历史",
	"hard-reset": "丢弃所有未提交的改动",
	"secret-file": "读写本机密钥文件",
	"write-system-path": "写入项目之外的系统路径",
	"shell-startup": "修改 shell 启动文件",
	"upload-file": "把本机文件上传到网络",

	// Programs that are dangerous whatever their arguments — `NEVER_UNATTENDED`.
	"switch-user": "切换用户",
	shutdown: "关机或重启",
	"format-disk": "格式化磁盘",
	"partition-disk": "修改磁盘分区",
	"modify-disk": "修改磁盘",
	"raw-disk-write": "按块写设备，可能覆盖磁盘",
	shred: "不可恢复地擦除文件",
	"change-owner": "更改文件归属",
	"system-service": "改动系统服务",
	crontab: "改动定时任务",
	"kill-all": "批量结束进程",
	"clear-disk": "清空磁盘",
	"execution-policy": "改动系统的脚本执行策略",
	"boot-config": "改动系统启动配置",
	"shadow-copies": "改动系统卷影副本",
	"event-log": "改动系统事件日志",
	"wipe-data": "可能不可恢复地擦除数据",

	// Subcommands that discard work or reach past this machine — `RISKY_SUBCOMMANDS`.
	"discard-changes": "可能丢弃未提交的改动",
	"delete-untracked": "删除未跟踪的文件",
	"rewrite-history": "重写提交历史",
	"overwrite-changes": "可能覆盖未提交的改动",
	"publish-package": "发布到公共仓库",
	"docker-prune": "可能清理镜像与卷",
	"delete-cluster-resource": "删除集群资源",
	"registry-edit": "修改注册表",
	"scheduled-task": "改动计划任务",
	firewall: "改动防火墙配置",

	// Writes — `assessWrite`.
	"write-sensitive-path": "写入项目之外的敏感路径",
	"write-outside-project": "写入当前项目之外的位置",

	// Network — `assessNetwork`.
	"cloud-metadata": "云元数据地址（这是取实例凭据的地方）",
	loopback: "本机回环地址",
	"private-network": "私有网段地址",
	"unparsable-url": "解析不了的地址",
	"unsupported-protocol": "不支持的协议 {protocol}",
	"credentials-in-url": "地址里带着账号密码",
	"local-service-write": "本机服务，但这个请求会改动它",
	"method-writes": "{method} 会改动对方的数据",
} as const;

export type RiskCode = keyof typeof RISK_REASONS;

/** The values a rule's sentence is filled in with — the HTTP method, the URL's protocol. */
export type RiskParams = Readonly<Record<string, string>>;

/** A rule's own sentence, with its values in place. */
export function riskReason(code: RiskCode, params?: RiskParams): string {
	const sentence: string = RISK_REASONS[code];
	if (!params) return sentence;
	return sentence.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
}
