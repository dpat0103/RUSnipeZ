import type { Campus } from "../api/types";

export const CAMPUSES: Campus[] = ["NB", "NK", "CM"];

export const CAMPUS_NAMES: Record<Campus, string> = {
  NB: "New Brunswick",
  NK: "Newark",
  CM: "Camden",
};

export const LOCATION_NAMES: Record<string, string> = {
  CAC: "College Avenue",
  BUS: "Busch",
  LIV: "Livingston",
  "D/C": "Cook / Douglass",
  ONL: "Online",
  DNB: "Downtown New Brunswick",
  OFF: "Off campus",
};

export const DAYS = [
  ["M", "Mon"],
  ["T", "Tue"],
  ["W", "Wed"],
  ["H", "Thu"],
  ["F", "Fri"],
] as const;

/** Set at build time. Without it the site explains that the bot is coming. */
export const DISCORD_INVITE: string | undefined = import.meta.env.VITE_DISCORD_INVITE || undefined;

export const GITHUB_URL = "https://github.com/dpat0103/RUSnipeZ";

export function webregUrl(term: string, index: string): string {
  const params = new URLSearchParams({ login: "cas", semesterSelection: term, indexList: index });
  return `https://sims.rutgers.edu/webreg/editSchedule.htm?${params}`;
}

/** Live data older than this is shown as delayed. */
export const STALE_AFTER_MS = 3 * 60_000;
