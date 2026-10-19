import type { Person } from "./types";

/** Name shown for "you" until a real Google account supplies one. */
export const YOU_PLACEHOLDER = "You";

/** Whether to append "(you)" after a name; skipped when the name already reads "You". */
export const showYouTag = (p: Person) => Boolean(p.isMe) && p.firstName !== YOU_PLACEHOLDER;
