/**
 * The languages the Git panel can ask the model to write a commit message in.
 *
 * Kept as data rather than a settings-page enum because the choice lives next to the wand, not
 * in a preference nobody would open before committing. The id is what is stored; the labels are
 * what the menu shows.
 */

export const COMMIT_LANGUAGES = [
	{ id: "zh", label: "中文", native: "简体中文" },
	{ id: "en", label: "English", native: "English" },
	{ id: "ja", label: "日本語", native: "日本語" },
	{ id: "ko", label: "한국어", native: "한국어" },
	{ id: "es", label: "Español", native: "Español" },
	{ id: "fr", label: "Français", native: "Français" },
	{ id: "de", label: "Deutsch", native: "Deutsch" },
	{ id: "pt", label: "Português", native: "Português" },
	{ id: "ru", label: "Русский", native: "Русский" },
] as const;

export type CommitLanguageId = (typeof COMMIT_LANGUAGES)[number]["id"];

export const DEFAULT_COMMIT_LANGUAGE: CommitLanguageId = "zh";

const KNOWN = new Set<string>(COMMIT_LANGUAGES.map((language) => language.id));

export function resolveCommitLanguage(id: string | undefined | null): CommitLanguageId {
	if (id && KNOWN.has(id)) return id as CommitLanguageId;
	return DEFAULT_COMMIT_LANGUAGE;
}

export function commitLanguageLabel(id: string | undefined | null): string {
	const resolved = resolveCommitLanguage(id);
	return COMMIT_LANGUAGES.find((language) => language.id === resolved)?.label ?? resolved;
}
