import assert from "node:assert/strict";
import { test } from "node:test";
import { suggestName } from "../src/features/vault/naming.ts";

test("引用名从名称里取拉丁字母；取不到就按类型起，撞名加序号", () => {
	assert.equal(suggestName("NAS admin", "login", []), "nas-admin");
	assert.equal(suggestName("  GitHub — Token!! ", "token", []), "github-token");
	assert.equal(suggestName("Café 服务器", "password", []), "cafe");
	assert.equal(suggestName("服务器密码", "password", []), "password");
	assert.equal(suggestName("部署钥匙", "ssh_key", ["ssh-key", "ssh-key-2"]), "ssh-key-3");
	assert.equal(suggestName("a".repeat(60), "token", []).length, 32);
	assert.match(suggestName("x".repeat(31) + " y", "token", []), /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "never ends on a hyphen when cut");
});
