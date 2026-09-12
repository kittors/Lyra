import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { isUnparsable, parseFrontmatter, type Skill } from "@lyra/core";
import path from "../resources/skills/browser/SKILL.md?asset";

export function browserSkill(): Skill {
	const parsed = parseFrontmatter(readFileSync(path, "utf8"));
	// 这一份是我们自己打包进去的，坏了是构建的问题而不是用户的——所以照样抛，但把话带上。
	if (isUnparsable(parsed)) throw new Error(`内置浏览器技能的 YAML 无法解析：${parsed.invalid}`);
	if (typeof parsed.frontmatter.name !== "string" || typeof parsed.frontmatter.description !== "string") throw new Error("内置浏览器技能格式无效");
	return { name: parsed.frontmatter.name, description: parsed.frontmatter.description, content: parsed.body, path, dir: dirname(path), source: "builtin", disableModelInvocation: false };
}
