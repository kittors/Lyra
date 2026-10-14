/**
 * What one command is given for the credentials it named: an askpass socket for passwords, an agent
 * socket for keys, and environment variables only where nothing else will do.
 *
 * Everything lives in a fresh 0700 directory under the user's temp, made for this command and
 * removed when it ends — so the sockets exist exactly as long as the command they were granted to.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ParsedKey } from "ssh2";
import { chooseAnswer, refusalNote, type AskpassSecret } from "./askpass-answer.ts";
import { serveAskpass, socketPathIn } from "./askpass-server.ts";
import { serveAgent } from "./ssh-agent.ts";
import { type CredentialMeta, envName, type FieldKey, type PreparedCommand } from "./types.ts";

/** A credential a command may use, with what it takes to use it. */
export interface Granted {
	meta: CredentialMeta;
	values: Partial<Record<FieldKey, string>>;
	/** An ssh key, parsed once when it was let in rather than on every signature. */
	key?: ParsedKey;
}

/** Whether the command names the variable, in any of the shells Lyra writes for. */
const mentions = (command: string, variable: string) => new RegExp(`\\$\\{?${variable}\\b|\\$env:${variable}\\b|%${variable}%`, "i").test(command);

/**
 * `stillHeld` is asked on every signature, so a credential removed while the command runs — the
 * person deleted it in settings — stops signing at once rather than when the command ends.
 */
export async function prepareCommand(granted: readonly Granted[], command: string, runtimeDir: string, stillHeld: (one: Granted) => boolean): Promise<PreparedCommand> {
	const dir = await mkdtemp(join(runtimeDir, "lyra-cred-"));
	const closers: (() => Promise<void>)[] = [];
	const env: Record<string, string> = {};
	const sockets: string[] = [];
	const notes = new Set<string>();
	try {
		const answerable = granted.filter((one) => one.meta.kind !== "ssh_key");
		if (answerable.length > 0) {
			const secrets: AskpassSecret[] = answerable.map((one) => ({
				name: one.meta.name,
				kind: one.meta.kind,
				...(one.meta.target ? { target: one.meta.target } : {}),
				...(one.meta.username ? { username: one.meta.username } : {}),
				secret: one.values.password ?? one.values.token ?? "",
			}));
			const server = await serveAskpass(dir, (prompt) => {
				const decision = chooseAnswer(prompt, secrets);
				if ("refused" in decision) {
					notes.add(refusalNote(prompt, decision.refused));
					return null;
				}
				return decision.answer;
			});
			closers.push(server.close);
			Object.assign(env, server.env);
			sockets.push(server.socket);
		}
		const keyed = granted.filter((one) => one.key);
		if (keyed.length > 0) {
			const path = socketPathIn(dir, "agent");
			// Looked up on every request, so a credential removed while the command runs stops signing at once.
			const agent = await serveAgent(path, () => keyed.filter((one) => stillHeld(one)).map((one) => ({ key: one.key!, name: one.meta.name })));
			closers.push(agent.close);
			env.SSH_AUTH_SOCK = path;
			sockets.push(path);
		}
		for (const one of granted) {
			const variable = envName(one.meta.name);
			const secret = one.values.token ?? one.values.password;
			/*
			 * Only into the environment when it can be used no other way: a token always is, a
			 * password only when the command names the variable. Everything in the environment is
			 * readable to the user's other processes (`ps eww`, measured).
			 */
			if (secret && (one.meta.kind === "token" || mentions(command, variable))) env[variable] = secret;
			if (one.meta.username) env[`${variable}_USERNAME`] = one.meta.username;
		}
	} catch (error) {
		await Promise.all(closers.map((close) => close().catch(() => {})));
		await rm(dir, { recursive: true, force: true }).catch(() => {});
		throw error;
	}
	let disposed = false;
	return {
		env,
		sockets,
		notes: () => [...notes],
		dispose: async () => {
			if (disposed) return;
			disposed = true;
			await Promise.all(closers.map((close) => close().catch(() => {})));
			await rm(dir, { recursive: true, force: true }).catch(() => {});
		},
	};
}
