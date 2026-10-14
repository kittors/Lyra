/**
 * The broker: a card goes out, a value comes back through its own channel, and a command gets the
 * smallest thing that lets it use the value.
 *
 * The card is played by `cardThat`, which does what a person at the window does: fills it through
 * `submit` and lets the approval resolve, or refuses. The one shortcut a window must not have —
 * answering "filled" without filling — is pinned as granting nothing.
 */

import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { test } from "node:test";
import ssh2 from "ssh2";
import { CredentialBroker, CredentialUnavailable } from "../src/credentials/broker.ts";
import { type CredentialRecord, memoryStore } from "../src/credentials/store.ts";
import type { CredentialAsk, CredentialSpec, CredentialSubmission } from "../src/credentials/types.ts";
import type { ApprovalRequest } from "../src/types.ts";

const KZHY: CredentialSpec = { name: "kzhy-root", title: "kzhy 的 root 密码", purpose: "改 Tailscale 配置", kind: "password", target: "ssh://root@100.64.0.5" };
const PASSWORD = "Tr0ub4dor&3-kzhy";

function cardThat(broker: CredentialBroker, answer: CredentialSubmission | "reject" | "skip-the-card") {
	const asked: ApprovalRequest[] = [];
	const ask: CredentialAsk = async (request) => {
		asked.push(structuredClone(request));
		if (answer === "reject") return "reject";
		if (answer !== "skip-the-card") {
			const filled = await broker.submit(request.credential!.key, answer);
			if (!filled.ok) return "reject";
		}
		return "once";
	};
	return { ask, asked };
}

const broker = (records: CredentialRecord[] = []) => new CredentialBroker({ vault: memoryStore(records), runtimeDir: tmpdir, now: () => 1000 });

test("卡片上没有值；值从 submit 进来，模型拿到的只有名字", async () => {
	const credentials = broker();
	const card = cardThat(credentials, { values: { password: PASSWORD } });
	const outcome = await credentials.forSession("s1").request(KZHY, card.ask);

	assert.equal(outcome.status, "provided");
	const [request] = card.asked;
	assert.equal(request!.kind, "credential");
	assert.equal(request!.credential!.name, "kzhy-root");
	assert.equal(request!.credential!.target, "ssh://root@100.64.0.5");
	assert.deepEqual(request!.credential!.fields, [{ key: "password", secret: true }]);
	assert.equal(JSON.stringify(card.asked).includes(PASSWORD), false, "nothing that went out carries the value");
	assert.equal(JSON.stringify(outcome).includes(PASSWORD), false);
	assert.equal(credentials.forSession("s1").reveal("kzhy-root"), PASSWORD);
	assert.equal(credentials.forSession("s2").reveal("kzhy-root"), undefined, "another conversation has none of it");
	assert.equal(outcome.status === "provided" && outcome.meta.saved, false, "not ticking remember is not saved, and the model is not told it is");
});

test("没填就答「已提交」等于什么都没给", async () => {
	const credentials = broker();
	assert.deepEqual(await credentials.forSession("s1").request(KZHY, cardThat(credentials, "skip-the-card").ask), { status: "declined" });
	assert.deepEqual(await credentials.forSession("s1").request(KZHY, cardThat(credentials, "reject").ask), { status: "declined" });
	assert.equal(credentials.forSession("s1").reveal("kzhy-root"), undefined);
});

test("名字、类型、目标不合规时不出卡片", async () => {
	const credentials = broker();
	const card = cardThat(credentials, { values: { password: "x" } });
	assert.equal((await credentials.forSession("s1").request({ ...KZHY, name: "Kzhy Root" }, card.ask)).status, "invalid");
	assert.equal((await credentials.forSession("s1").request({ ...KZHY, target: "ftp://x" }, card.ask)).status, "invalid");
	assert.equal(card.asked.length, 0);
});

test("同一个对话再要同一个凭据，不再出第二张卡", async () => {
	const credentials = broker();
	const first = cardThat(credentials, { values: { password: PASSWORD } });
	await credentials.forSession("s1").request(KZHY, first.ask);
	const again = cardThat(credentials, { values: { password: "other" } });
	assert.equal((await credentials.forSession("s1").request(KZHY, again.ask)).status, "provided");
	assert.equal(again.asked.length, 0);
});

test("勾了记住才落进保险库；登录名存成名字，不算秘密", async () => {
	const vault = memoryStore();
	const credentials = new CredentialBroker({ vault, runtimeDir: tmpdir, now: () => 7 });
	await credentials.forSession("s1").request(KZHY, cardThat(credentials, { values: { password: PASSWORD } }).ask);
	assert.deepEqual(await vault.list(), []);

	const login: CredentialSpec = { name: "sub-admin", title: "订阅后台", purpose: "登录", kind: "login", target: "https://sub.example" };
	await credentials.forSession("s1").request(login, cardThat(credentials, { values: { username: "admin", password: "pw-123456" }, remember: true }).ask);
	const [saved] = await vault.list();
	assert.equal(saved!.username, "admin");
	assert.deepEqual(saved!.values, { password: "pw-123456" });
	assert.equal(credentials.forSession("s1").describe("sub-admin")!.saved, true);
	assert.deepEqual(credentials.forSession("s1").secrets().map((secret) => secret.value), [PASSWORD, "pw-123456"], "the username is not masked");
	assert.equal(credentials.forSession("s1").reveal("sub-admin.username"), "admin");
});

test("存过的同名凭据先拿出来问；用它时记一下用过的时间", async () => {
	const vault = memoryStore([{ name: "kzhy-root", kind: "password", title: "旧标题", target: "ssh://root@100.64.0.5", createdAt: 5, approval: "per-conversation", values: { password: PASSWORD } }]);
	const credentials = new CredentialBroker({ vault, runtimeDir: tmpdir, now: () => 99 });
	const card = cardThat(credentials, { useSaved: true });
	assert.equal((await credentials.forSession("s1").request(KZHY, card.ask)).status, "provided");
	assert.deepEqual(card.asked[0]!.credential!.saved, { createdAt: 5, target: "ssh://root@100.64.0.5" });
	assert.equal(credentials.forSession("s1").reveal("kzhy-root"), PASSWORD);
	assert.equal((await vault.get("kzhy-root"))!.usedAt, 99);
});

test("给一条命令：密码走 askpass，不进环境变量——除非命令点名要那个变量", async () => {
	const credentials = broker();
	const conversation = credentials.forSession("s1");
	await conversation.request(KZHY, cardThat(credentials, { values: { password: PASSWORD } }).ask);
	const plain = await conversation.prepare(["kzhy-root"], "ssh root@100.64.0.5 uptime", cardThat(credentials, "reject").ask);
	try {
		assert.equal(plain.env.SSH_ASKPASS_REQUIRE, "force");
		assert.ok(plain.env.SSH_ASKPASS && plain.env.SUDO_ASKPASS && plain.env.GIT_ASKPASS);
		assert.equal(JSON.stringify(plain.env).includes(PASSWORD), false);
		assert.equal(plain.sockets.length, 1);
	} finally {
		await plain.dispose();
	}
	await assert.rejects(access(plain.env.SSH_ASKPASS!), "the wrapper and its directory are gone with the command");

	const named = await conversation.prepare(["kzhy-root"], 'mysql -p"$KZHY_ROOT"', cardThat(credentials, "reject").ask);
	assert.equal(named.env.KZHY_ROOT, PASSWORD);
	await named.dispose();
	await named.dispose();
});

test("令牌总在环境变量里；登录名带一个 _USERNAME", async () => {
	const credentials = broker();
	const conversation = credentials.forSession("s1");
	await conversation.request({ name: "linear-token", title: "Linear", purpose: "查 issue", kind: "token", target: "https://api.linear.app" }, cardThat(credentials, { values: { token: "lin_api_123456" } }).ask);
	await conversation.request({ name: "sub-admin", title: "后台", purpose: "登录", kind: "login" }, cardThat(credentials, { values: { username: "admin", password: "pw-123456" } }).ask);
	const prepared = await conversation.prepare(["linear-token", "sub-admin"], "curl", cardThat(credentials, "reject").ask);
	assert.equal(prepared.env.LINEAR_TOKEN, "lin_api_123456");
	assert.equal(prepared.env.SUB_ADMIN_USERNAME, "admin");
	assert.equal(prepared.env.SUB_ADMIN, undefined, "a login's password is for askpass unless the command names it");
	await prepared.dispose();
});

test("SSH 私钥：口令错了卡片不关、改对再交；命令只拿到一个 agent socket", async () => {
	const credentials = broker();
	const pair = ssh2.utils.generateKeyPairSync("ed25519", { passphrase: "right", cipher: "aes256-ctr" } as never);
	const spec: CredentialSpec = { name: "deploy-key", title: "部署密钥", purpose: "拉代码", kind: "ssh_key", target: "ssh://git@git.example" };
	let attempts = 0;
	const ask: CredentialAsk = async (request) => {
		const key = request.credential!.key;
		assert.deepEqual(await credentials.submit(key, { values: { private_key: pair.private, passphrase: "wrong" } }), { ok: false, problem: "wrong-passphrase" });
		assert.deepEqual(await credentials.submit(key, { values: {} }), { ok: false, problem: "missing" });
		attempts++;
		assert.deepEqual(await credentials.submit(key, { values: { private_key: `\n${pair.private}\n`, passphrase: "right" } }), { ok: true });
		return "once";
	};
	const conversation = credentials.forSession("s1");
	assert.equal((await conversation.request(spec, ask)).status, "provided");
	assert.equal(attempts, 1);
	assert.ok(conversation.secrets().some((secret) => secret.label === "deploy-key.passphrase"), "the passphrase is masked under its own label");

	const prepared = await conversation.prepare(["deploy-key"], "git clone git@git.example:x", cardThat(credentials, "reject").ask);
	try {
		assert.ok(prepared.env.SSH_AUTH_SOCK);
		assert.equal(prepared.env.SSH_ASKPASS, undefined, "a key needs no askpass");
		assert.equal(JSON.stringify(prepared.env).includes("BEGIN OPENSSH"), false);
		const answer = await new Promise<number>((resolve) => {
			const socket = connect(prepared.env.SSH_AUTH_SOCK!, () => socket.write(Buffer.from([0, 0, 0, 1, 11])));
			socket.once("data", (chunk: Buffer) => {
				resolve(chunk[4]!);
				socket.destroy();
			});
		});
		assert.equal(answer, 12, "the agent lists the key");
	} finally {
		await prepared.dispose();
	}
});

test("命令点了一个这个对话没有的名字：存过的先问，没有的直接报错", async () => {
	const saved: CredentialRecord = { name: "nas", kind: "password", title: "NAS", createdAt: 1, approval: "per-conversation", values: { password: "nas-pass-1" } };
	const credentials = broker([saved]);
	const conversation = credentials.forSession("s1");
	await assert.rejects(conversation.prepare(["nope"], "x", cardThat(credentials, "reject").ask), (error) => error instanceof CredentialUnavailable && /request_credential/.test(error.message));
	await assert.rejects(conversation.prepare(["nas"], "x", cardThat(credentials, "reject").ask), (error) => error instanceof CredentialUnavailable && /declined/.test(error.message));

	const card = cardThat(credentials, { useSaved: true });
	const prepared = await conversation.prepare(["nas"], "x", card.ask);
	await prepared.dispose();
	assert.equal(card.asked.length, 1);
	const again = cardThat(credentials, "reject");
	await (await conversation.prepare(["nas"], "x", again.ask)).dispose();
	assert.equal(again.asked.length, 0, "per conversation: asked once, then let be");
});

test("授权档位：不用问的直接用，每次都问的每条命令都问", async () => {
	const never: CredentialRecord = { name: "ci-token", kind: "token", title: "CI", createdAt: 1, approval: "never", values: { token: "ci-token-value" } };
	const every: CredentialRecord = { name: "prod-db", kind: "password", title: "生产库", createdAt: 1, approval: "every-use", values: { password: "prod-pass-1" } };
	const credentials = broker([never, every]);
	const conversation = credentials.forSession("s1");
	const silent = cardThat(credentials, "reject");
	await (await conversation.prepare(["ci-token"], "x", silent.ask)).dispose();
	assert.equal(silent.asked.length, 0);

	const each = cardThat(credentials, { useSaved: true });
	await (await conversation.prepare(["prod-db"], "x", each.ask)).dispose();
	await (await conversation.prepare(["prod-db"], "x", each.ask)).dispose();
	assert.equal(each.asked.length, 2);
});

test("在设置里改绑定、删除，正在用它的对话立刻跟着变；对话里自己填的不受影响", async () => {
	const saved: CredentialRecord = { name: "nas", kind: "password", title: "NAS", target: "ssh://admin@nas.lan", createdAt: 1, approval: "never", values: { password: "nas-pass-1" } };
	const credentials = broker([saved]);
	const conversation = credentials.forSession("s1");
	await (await conversation.prepare(["nas"], "x", cardThat(credentials, "reject").ask)).dispose();
	await conversation.request(KZHY, cardThat(credentials, { values: { password: PASSWORD } }).ask);

	const moved = await credentials.updateSaved("nas", { target: "ssh://admin@10.0.0.2" });
	assert.equal(moved.ok && moved.record.target, "ssh://admin@10.0.0.2");
	assert.equal(conversation.describe("nas")!.target, "ssh://admin@10.0.0.2");
	assert.equal((await credentials.updateSaved("nas", { target: "ftp://x" })).ok, false, "an invalid target is refused");
	await credentials.updateSaved("nas", { values: { password: "nas-pass-2" } });
	assert.equal(conversation.reveal("nas"), "nas-pass-2", "a value typed again on the vault page reaches the conversation using it");

	await credentials.removeSaved("nas");
	assert.equal(conversation.describe("nas"), undefined);
	assert.equal(conversation.reveal("kzhy-root"), PASSWORD);
	assert.deepEqual((await credentials.saved()).map((meta) => meta.name), []);

	credentials.forget("s1");
	assert.equal(conversation.reveal("kzhy-root"), undefined);
});

test("同一组值复用同一个脱敏器，值变了才重建", async () => {
	const credentials = broker();
	const conversation = credentials.forSession("s1");
	const empty = conversation.redactor();
	assert.equal(empty.empty, true);
	await conversation.request(KZHY, cardThat(credentials, { values: { password: PASSWORD } }).ask);
	const first = conversation.redactor();
	assert.notEqual(first, empty);
	assert.equal(conversation.redactor(), first);
	assert.equal(first.text(`echo ${PASSWORD}`), "echo [credential:kzhy-root]");
});

test("过期的卡片交不上来", async () => {
	assert.deepEqual(await broker().submit("no-such-key", { values: { password: "x" } }), { ok: false, problem: "expired" });
});

test("保险箱页面手动添加：名字不重、字段要齐、私钥要打得开；值不出现在列表里", async () => {
	const credentials = broker();
	const added = await credentials.addSaved({ name: "nas", kind: "login", title: "家里的 NAS", target: "https://nas.lan", values: { username: " admin ", password: "nas pass 1" } });
	assert.equal(added.ok, true);
	const [listed] = await credentials.saved();
	assert.deepEqual({ ...listed }, { name: "nas", kind: "login", title: "家里的 NAS", target: "https://nas.lan", username: "admin", createdAt: 1000, approval: "per-conversation", saved: true });
	assert.equal(JSON.stringify(await credentials.saved()).includes("nas pass 1"), false);

	assert.deepEqual(await credentials.addSaved({ name: "nas", kind: "password", title: "again", values: { password: "x" } }), { ok: false, problem: "exists" });
	assert.deepEqual(await credentials.addSaved({ name: "token", kind: "token", title: "t", values: {} }), { ok: false, problem: "missing" });
	assert.equal((await credentials.addSaved({ name: "Bad Name", kind: "token", title: "t", values: { token: "x" } })).ok, false);
	const locked = ssh2.utils.generateKeyPairSync("ed25519", { passphrase: "right", cipher: "aes256-ctr" } as never).private;
	assert.deepEqual(await credentials.addSaved({ name: "key", kind: "ssh_key", title: "k", values: { private_key: locked } }), { ok: false, problem: "needs-passphrase" });
	assert.equal((await credentials.addSaved({ name: "key", kind: "ssh_key", title: "k", values: { private_key: locked, passphrase: "right" } })).ok, true);
});

test("发消息兜底：粘贴进来的真值换成引用；粘贴的引用直接放行，不再出卡片", async () => {
	const credentials = broker([
		{ name: "nas", kind: "password", title: "NAS", createdAt: 1, approval: "per-conversation", values: { password: "nas-pass-123" } },
		{ name: "pin", kind: "password", title: "PIN", createdAt: 1, approval: "per-conversation", values: { password: "4821" } },
	]);
	const pasted = await credentials.screenPrompt(null, ["登录 nas，密码是 nas-pass-123，门禁 4821", "shown: nas-pass-123"]);
	assert.deepEqual(pasted.texts, ["登录 nas，密码是 [credential:nas]，门禁 4821", "shown: [credential:nas]"], "a short value is left alone in a message");
	assert.deepEqual(pasted.named, ["nas"]);
	assert.equal(credentials.forSession("s1").reveal("nas"), undefined, "screening alone lets nothing in");
	await credentials.letIn("s1", pasted.named);
	assert.equal(credentials.forSession("s1").reveal("nas"), "nas-pass-123", "let into the conversation that named it");

	const referenced = await credentials.screenPrompt("s2", ["用 [credential:nas] 登录，[credential:unknown] 只是字"]);
	assert.deepEqual(referenced, { texts: ["用 [credential:nas] 登录，[credential:unknown] 只是字"], named: ["nas"] });
	await credentials.letIn("s2", referenced.named);
	const card = cardThat(credentials, "reject");
	await (await credentials.forSession("s2").prepare(["nas"], "x", card.ask)).dispose();
	assert.equal(card.asked.length, 0, "handed over by the person, so no card asks again");
	// The model knows only the name, so it guesses the kind; the answer corrects it instead of asking anew.
	const guessed = await credentials.forSession("s2").request({ name: "nas", title: "NAS", purpose: "登录", kind: "login" }, card.ask);
	assert.deepEqual(guessed.status === "provided" && [guessed.meta.kind, guessed.meta.saved], ["password", true]);
	assert.equal(card.asked.length, 0);
	assert.equal(credentials.forSession("s3").reveal("nas"), undefined, "and only to the conversation it was pasted into");
});

test("发消息兜底也认得这个对话里卡片填过、没存的值", async () => {
	const credentials = broker();
	await credentials.forSession("s1").request(KZHY, cardThat(credentials, { values: { password: PASSWORD } }).ask);
	assert.deepEqual((await credentials.screenPrompt("s1", [`再试一次 ${PASSWORD}`])).texts, ["再试一次 [credential:kzhy-root]"]);
});

test("复制：密码与令牌给值本身；钥匙只给公钥那一行", async () => {
	const pair = ssh2.utils.generateKeyPairSync("ed25519", { comment: "me@laptop" } as never);
	const credentials = broker([
		{ name: "nas", kind: "login", title: "NAS", username: "admin", createdAt: 1, approval: "per-conversation", values: { password: "nas-pass-123" } },
		{ name: "gh", kind: "token", title: "GitHub", createdAt: 1, approval: "per-conversation", values: { token: "ghp_abcdefghijkl" } },
		{ name: "deploy", kind: "ssh_key", title: "部署", createdAt: 1, approval: "per-conversation", values: { private_key: pair.private } },
	]);
	assert.deepEqual(await credentials.copyable("nas"), { text: "nas-pass-123", secret: true });
	assert.deepEqual(await credentials.copyable("gh"), { text: "ghp_abcdefghijkl", secret: true });
	const key = await credentials.copyable("deploy");
	assert.equal(key?.secret, false);
	assert.equal(key?.text, pair.public.trim(), "the same line ssh-keygen -y would print");
	assert.equal(await credentials.copyable("gone"), null);
});

test("对话能点名的：存下的全部，加这个对话里卡片填过、没存的；复制也认后者，只在那个对话里", async () => {
	const credentials = broker([{ name: "nas", kind: "password", title: "NAS", createdAt: 1, approval: "per-conversation", values: { password: "nas-pass-123" } }]);
	await credentials.forSession("s1").request(KZHY, cardThat(credentials, { values: { password: PASSWORD } }).ask);
	assert.deepEqual((await credentials.known("s1")).map((meta) => [meta.name, meta.saved]), [["nas", true], ["kzhy-root", false]]);
	assert.deepEqual((await credentials.known()).map((meta) => meta.name), ["nas"], "the vault page lists only what is saved");
	assert.deepEqual((await credentials.forSession("s1").list()).map((meta) => meta.name), ["nas", "kzhy-root"]);
	assert.deepEqual(await credentials.copyable("kzhy-root", "s1"), { text: PASSWORD, secret: true });
	assert.equal(await credentials.copyable("kzhy-root", "s2"), null, "another conversation was never given it");
	assert.equal(await credentials.copyable("kzhy-root"), null);
	assert.deepEqual(await credentials.known("s3"), await credentials.known(), "asking about a conversation holds nothing for it");
});
