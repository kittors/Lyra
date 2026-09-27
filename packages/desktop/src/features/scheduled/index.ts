/**
 * The schedule, as the rest of the window reaches it.
 *
 * Not `ScheduledView`. Only the shell draws that, through `lazy()`, and exporting it here would pull
 * the whole page back into the main chunk — see `features-through-the-front-door` in the dependency
 * rules. What other places need is what the scheduler has said: the line above the composer, the
 * count on the sidebar, and the listener the shell mounts once.
 */

export { ScheduledAlert } from "./ScheduledAlert.tsx";
export { useScheduledNotices, useSchedulerNotices } from "./notices.ts";
