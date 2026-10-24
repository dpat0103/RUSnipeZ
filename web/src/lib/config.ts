import type { Campus } from "../api/types";

export const CAMPUSES: Campus[] = ["NB", "NK", "CM", "OC"];

export const CAMPUS_NAMES: Record<Campus, string> = {
  NB: "New Brunswick",
  NK: "Newark",
  CM: "Camden",
  OC: "Off-campus",
};

/** Rutgers' off-campus locations by section campus code, named as the Schedule of Classes does. */
export const OFF_CAMPUS_NAMES: Record<string, string> = {
  B: "Burlington County College, Mt Laurel",
  CC: "Camden County College, Blackwood",
  H: "County College of Morris",
  CU: "Cumberland County College",
  MC: "Denville (RU-Morris)",
  WM: "Freehold (WMHEC)",
  L: "Lincroft (RU-BCC)",
  AC: "Mays Landing (RU-ACCC)",
  J: "Joint Base McGuire-Dix-Lakehurst",
  D: "Mercer County Community College",
  RV: "North Branch (RU-RVCC)",
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

/** The community server's permanent invite. VITE_DISCORD_INVITE overrides it at build time. */
export const DISCORD_INVITE: string | undefined =
  import.meta.env.VITE_DISCORD_INVITE || "https://discord.gg/7cuCT2jJR6";

export const GITHUB_URL = "https://github.com/dpat0103/RUSnipeZ";

export function webregUrl(term: string, index: string): string {
  const params = new URLSearchParams({ login: "cas", semesterSelection: term, indexList: index });
  return `https://sims.rutgers.edu/webreg/editSchedule.htm?${params}`;
}

/** Live data older than this is shown as delayed. */
export const STALE_AFTER_MS = 3 * 60_000;
