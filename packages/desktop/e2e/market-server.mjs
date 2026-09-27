/* oxlint-disable no-console -- a test server that says where it is listening */
// 本地的一个「市场」，给插件市场的真窗口探针用：https://localhost:<PORT>/v1/index 列出全部条目，
// MCP 包装按平台的方式打成 tar.gz、带 sha256（包里就是包本身，不带外层目录）。
//
// 用法：PORT=8443 node e2e/market-server.mjs <entries.json>
//   entries.json：{ entries: [RegistryEntry...], wrappers: "<Lyra-Plugins 仓库目录>" }
//
// 证书：自签一个 CA 和 localhost 的证书放在 MARKET_TLS（缺省 /tmp/plugin-verify/tls），应用那边用
// NODE_EXTRA_CA_CERTS=<ca.pem> 交给它——证书校验照常开着，不用关：
//   openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days 30 -subj "/CN=Lyra Test CA"
//   openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=localhost"
//   printf "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n" > ext.cnf
//   openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out server.pem -days 30 -extfile ext.cnf
import { createServer } from "node:https";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TLS = process.env.MARKET_TLS ?? "/tmp/plugin-verify/tls";
const PORT = Number(process.env.PORT ?? 8443);
const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = join(tmpdir(), `lyra-market-${PORT}`);
mkdirSync(out, { recursive: true });

const archives = new Map();
const entries = config.entries.map((entry) => {
	const dir = config.wrappers && entry.path?.startsWith("plugins/") ? join(config.wrappers, entry.path) : null;
	if (!dir || !existsSync(dir)) return entry;
	const file = join(out, `${entry.id}.tar.gz`);
	execFileSync("tar", ["-czf", file, "-C", dir, "."]);
	const bytes = readFileSync(file);
	archives.set(entry.id, bytes);
	return { ...entry, tarball: `https://localhost:${PORT}/dl/${entry.id}.tar.gz`, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
});

const server = createServer({ key: readFileSync(join(TLS, "server.key")), cert: readFileSync(join(TLS, "server.pem")) }, (req, res) => {
	const url = new URL(req.url ?? "/", `https://localhost:${PORT}`);
	if (url.pathname === "/v1/index") {
		const kind = url.searchParams.get("kind");
		const list = kind ? entries.filter((entry) => entry.kind === kind) : entries;
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ name: "Lyra 测试市场", updatedAt: new Date().toISOString(), entries: list }));
		return;
	}
	const match = /^\/dl\/([a-z0-9._-]+)\.tar\.gz$/.exec(url.pathname);
	if (match && archives.has(match[1])) {
		res.writeHead(200, { "content-type": "application/gzip" });
		res.end(archives.get(match[1]));
		return;
	}
	res.writeHead(404);
	res.end("not found");
});
server.listen(PORT, "127.0.0.1", () => console.log(`测试市场：https://localhost:${PORT}/v1/index，${entries.length} 个条目，${archives.size} 个包`));
