/**
 * The browser-safe half of slash commands.
 *
 * Finding command files needs a filesystem; parsing `/name args`, substituting the arguments and
 * ranking a list against what has been typed does not. They are separated by an export path rather
 * than by convention, for the same reason the trajectory is: the composer importing the main
 * barrel is how a native module ends up in the renderer's bundle, and that is a mistake nobody can
 * make if the door is not there.
 *
 * `SlashCommand` comes along as a type only, which erases at compile time and pulls nothing in.
 */

export { expandCommand, parseInvocation, parseSkillMention, rankCommands, resolveCommand, skillNameOf, splitArguments, type Invocation } from "./commands/expand.ts";
export type { SlashCommand } from "./commands/loader.ts";
