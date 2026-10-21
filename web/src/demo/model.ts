// State and pure logic for the Discord preview: a snipe list and a bot
// conversation that mirror the planned Discord commands. It lives in
// sessionStorage, so it survives a refresh and resets when the tab closes.

import type { CatalogCourse, CatalogSection, Meeting, Stats } from "../api/types";

/** Matches the planned per-user limit for the Discord bot. */
export const WATCH_LIMIT = 15;
const MAX_MESSAGES = 60;

export interface Watch {
  term: string;
  termName: string;
  index: string;
  campus: string | null;
  courseCode: string;
  courseTitle: string;
  sectionNumber: string;
  instructors: string[];
  meets: Meeting[];
  spn: boolean;
  crossListed: string[];
  snoozedUntil: number | null;
}

export interface CourseLine {
  index: string;
  number: string;
  instructors: string[];
  open: boolean | null;
}

export type Reply =
  | { type: "snipe"; watch: Watch; result: "added" | "duplicate" | "limit"; openNow: boolean | null; count: number }
  | { type: "not-found"; what: string }
  | { type: "check"; rows: { watch: Watch; open: boolean | null }[] }
  | { type: "remove"; index: string; watch: Watch | null }
  | { type: "clear-confirm"; count: number; resolution: "pending" | "confirmed" | "cancelled" }
  | { type: "lastopen"; term: string; index: string; title: string | null; sectionNumber: string | null }
  | { type: "course"; termName: string; code: string; title: string; campus: string; sections: CourseLine[] }
  | { type: "status"; stats: Stats | null }
  | { type: "help" }
  | { type: "alert"; watch: Watch; preview: boolean; handled: "snoozed" | "stopped" | "got-in" | null }
  | { type: "error"; text: string };

export interface Message {
  id: number;
  at: number;
  /** The slash command as the user ran it; null for direct messages. */
  command: string | null;
  reply: Reply;
}

export interface DemoState {
  watches: Watch[];
  messages: Message[];
  nextId: number;
}

export const EMPTY: DemoState = { watches: [], messages: [], nextId: 1 };

export type Action =
  | { type: "post"; command: string | null; reply: Reply; at: number }
  | { type: "add-watch"; watch: Watch }
  | { type: "remove-watch"; term: string; index: string }
  | { type: "clear-watches" }
  | { type: "resolve-clear"; id: number; confirmed: boolean }
  | { type: "alert-handled"; id: number; handled: "snoozed" | "stopped" | "got-in" }
  | { type: "snooze"; term: string; index: string; until: number }
  | { type: "reset" };

export const sameWatch = (a: { term: string; index: string }, b: { term: string; index: string }) =>
  a.term === b.term && a.index === b.index;

export function reducer(state: DemoState, action: Action): DemoState {
  switch (action.type) {
    case "post": {
      const message: Message = { id: state.nextId, at: action.at, command: action.command, reply: action.reply };
      return { ...state, messages: [...state.messages, message].slice(-MAX_MESSAGES), nextId: state.nextId + 1 };
    }
    case "add-watch":
      if (state.watches.some((w) => sameWatch(w, action.watch)) || state.watches.length >= WATCH_LIMIT) return state;
      return { ...state, watches: [...state.watches, action.watch] };
    case "remove-watch":
      return { ...state, watches: state.watches.filter((w) => !sameWatch(w, action)) };
    case "clear-watches":
      return { ...state, watches: [] };
    case "resolve-clear":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.id && m.reply.type === "clear-confirm"
            ? { ...m, reply: { ...m.reply, resolution: action.confirmed ? "confirmed" : "cancelled" } }
            : m,
        ),
      };
    case "alert-handled":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.id && m.reply.type === "alert" ? { ...m, reply: { ...m.reply, handled: action.handled } } : m,
        ),
      };
    case "snooze":
      return {
        ...state,
        watches: state.watches.map((w) => (sameWatch(w, action) ? { ...w, snoozedUntil: action.until } : w)),
      };
    case "reset":
      return EMPTY;
  }
}

/** A watch built from a catalog course and section. */
export function watchFrom(term: string, termName: string, course: CatalogCourse, section: CatalogSection): Watch {
  return {
    term,
    termName,
    index: section.index,
    campus: section.campus || null,
    courseCode: course.code,
    courseTitle: course.title,
    sectionNumber: section.number,
    instructors: section.instructors,
    meets: section.meets,
    spn: section.spn,
    crossListed: section.crossListed,
    snoozedUntil: null,
  };
}

/** What /snipe answers for a section, given the current list. */
export function snipeResult(watches: Watch[], watch: Watch): "added" | "duplicate" | "limit" {
  if (watches.some((w) => sameWatch(w, watch))) return "duplicate";
  return watches.length >= WATCH_LIMIT ? "limit" : "added";
}

export type Command =
  | { name: "snipe" | "remove" | "lastopen"; index: string }
  | { name: "course"; code: string }
  | { name: "check" | "clear" | "status" | "help" };

export const COMMANDS: { usage: string; description: string }[] = [
  { usage: "/snipe <index>", description: "Watch a section. You get a DM the moment it opens." },
  { usage: "/check", description: "List what you are watching, open sections first." },
  { usage: "/remove <index>", description: "Stop watching a section." },
  { usage: "/clear", description: "Stop watching everything, after a confirmation." },
  { usage: "/lastopen <index>", description: "When a section was last open, and how often it opens." },
  { usage: "/course <code>", description: "Every section of a course, with live status." },
  { usage: "/status", description: "When Rutgers was last checked, and uptime." },
  { usage: "/help", description: "This list." },
];

/** Parse a typed slash command. Returns a command or a message explaining the problem. */
export function parseCommand(text: string): Command | { error: string } {
  const [rawName = "", ...rest] = text.trim().split(/\s+/);
  const name = rawName.replace(/^\//, "").toLowerCase();
  const arg = rest.join(" ");
  switch (name) {
    case "snipe":
    case "remove":
    case "lastopen":
      return /^\d{5}$/.test(arg) ? { name, index: arg } : { error: `/${name} needs a 5-digit index, like /${name} 12345.` };
    case "course":
      return /^\d{2}:\d{3}:\d{3}$/.test(arg)
        ? { name, code: arg }
        : { error: "/course needs a course code, like /course 01:198:111." };
    case "check":
    case "clear":
    case "status":
    case "help":
      return { name };
    default:
      return { error: `Unknown command${rawName ? ` ${rawName}` : ""}. Try /help.` };
  }
}

/**
 * Watched sections that just opened: open now, seen closed on the previous
 * check, and not snoozed. Returns the alerts and the statuses to remember.
 */
export function newlyOpened(
  previous: Map<string, boolean>,
  watches: Watch[],
  openByTerm: Map<string, Set<string> | undefined>,
  now: number,
): { alerts: Watch[]; next: Map<string, boolean> } {
  const next = new Map(previous);
  const alerts: Watch[] = [];
  for (const watch of watches) {
    const open = openByTerm.get(watch.term);
    if (!open) continue;
    const key = `${watch.term}:${watch.index}`;
    const isOpen = open.has(watch.index);
    if (previous.get(key) === false && isOpen && !(watch.snoozedUntil && watch.snoozedUntil > now)) {
      alerts.push(watch);
    }
    next.set(key, isOpen);
  }
  return { alerts, next };
}

const STORAGE_KEY = "rusnipez.discord-preview.v1";

export function loadState(): DemoState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as DemoState;
    return Array.isArray(parsed.watches) && Array.isArray(parsed.messages) && Number.isInteger(parsed.nextId)
      ? parsed
      : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function saveState(state: DemoState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked or full: the preview still works for this page view.
  }
}
