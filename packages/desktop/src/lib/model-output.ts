/**
 * What the model editor stores for 「用途」 (conversation, images, video).
 *
 * Here rather than in the editor so it can be tested without a window: it is a rule, and a rule that
 * only exists inside a component is one nobody checks.
 */

import type { ModelConfig } from "@lyra/core";
import { type MediaKind, mediaKindOfId } from "@lyra/core/image-models";

/**
 * The stored switches that make a model the kind chosen for it, given what its name says — none at
 * all where the name already says it, so an untouched model keeps following the naming rule.
 * See `mediaKind`: a stored `true` wins, a stored `false` only says "not this kind".
 */
export function outputOverrides(modelId: string, output: "chat" | MediaKind): Pick<ModelConfig, "imageOutput" | "videoOutput"> {
	const named = mediaKindOfId(modelId);
	if (output === (named ?? "chat")) return { imageOutput: undefined, videoOutput: undefined };
	if (output === "image") return { imageOutput: true, videoOutput: undefined };
	if (output === "video") return { imageOutput: undefined, videoOutput: true };
	return named === "video" ? { imageOutput: undefined, videoOutput: false } : { imageOutput: false, videoOutput: undefined };
}
