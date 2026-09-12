export interface ImportedFont {
	id: string;
	name: string;
	family: string;
	format: "ttf" | "otf" | "woff" | "woff2";
	size: number;
}

/** Container checks cannot validate every outline; callers must also await FontFace.load(). */
export interface ImportedFontData extends ImportedFont {
	/** A complete data:font/...;base64 URL, never a local filesystem path. */
	data: string;
}
