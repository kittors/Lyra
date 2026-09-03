# 安全

## 报告漏洞

不要开公开 issue。请用 GitHub 的
[私密漏洞报告](https://github.com/kittors/Lyra/security/advisories/new)。

## 这个项目的攻击面

Lyra 会在你的机器上执行模型给出的命令。这是它的用途，也是它最需要小心的地方：

- **命令在你的用户身份下运行**，能碰到你能碰到的一切。
- **风险判定**（`packages/core/src/tools/risk*.ts`）决定哪些命令可以直接执行、哪些
  要先问你。判定逻辑的漏洞——比如某种写法绕过了递归删除的检查——是安全问题，
  按上面的方式私密报告。
- **技能与插件是代码**。装一个插件等于同意运行它的代码。
- **API key 存在 `~/.lyra/settings.json`**，明文，权限跟随文件系统。它不在仓库里，
  也不会被同步到移动端以外的地方。
- **局域网同步**默认只监听本机网段，且需要配对。把它暴露到公网不是设计意图。

## 依赖

`pnpm audit --prod` 是零。传递依赖里出现的通告用 `pnpm-workspace.yaml` 的 `overrides` 压住，
dependabot 每周会送来直接依赖的升级。

有一个例外要人工盯：**`xlsx` 从 SheetJS 自己的 CDN 装**，不是 npm。npm 上的最后一版是
0.18.5，带着两条 high，而修复版本只在 `cdn.sheetjs.com` 上发布。dependabot 跟踪不了 URL
形式的依赖，所以它不会提醒你。每个季度手动看一次：

```bash
curl -s https://cdn.sheetjs.com/ | grep -o 'xlsx-[0-9.]*' | sort -V | tail -1
```

## 不算漏洞的

- 模型自己写出的危险命令被审批拦下来了——那是拦截生效，不是漏洞。
- 你自己按了"允许"之后发生的事。
