// Registered with `--import` after tsx, so its `resolve` runs before tsx sees an asset specifier.
import { register } from "node:module";

register("./assets-hooks.mjs", import.meta.url);
