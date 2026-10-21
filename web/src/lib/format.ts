import type { Meeting } from "../api/types";
import { LOCATION_NAMES } from "./config";

const number = new Intl.NumberFormat("en-US");

export function formatCount(value: number): string {
  return number.format(value);
}

/** "1 course", "2,916 sections". */
export function plural(count: number, word: string): string {
  return `${formatCount(count)} ${word}${count === 1 ? "" : "s"}`;
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(ratio >= 0.9995 ? 0 : 1)}%`;
}

/** "15:50" becomes "3:50 PM". */
export function clock(hhmm: string | null): string {
  if (!hhmm) return "";
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function meetingSummary(meets: Meeting[]): string {
  if (meets.length === 0) return "No meeting time listed";
  return meets
    .map((m) => {
      const when = m.start ? `${m.days || "TBA"} ${clock(m.start)}–${clock(m.end)}` : "Online, no set time";
      const where = [m.where, m.start ? LOCATION_NAMES[m.campus] ?? m.campus : ""]
        .filter(Boolean)
        .join(", ");
      return where ? `${when} · ${where}` : when;
    })
    .join(" / ");
}

const DAY_NAMES: Record<string, string> = {
  M: "Mon", T: "Tue", W: "Wed", H: "Thu", F: "Fri", S: "Sat", U: "Sun",
};

/** Rutgers day codes ("H" is Thursday) as readable names: "TH" becomes "Tue Thu". */
export function dayNames(days: string): string {
  return [...days].map((d) => DAY_NAMES[d] ?? d).join(" ");
}

/** "10:35–11:30 AM", or "11:30 AM–12:50 PM" when the range crosses noon. */
export function timeRange(start: string, end: string | null): string {
  const from = clock(start);
  const to = clock(end);
  if (!to) return from;
  return from.slice(-2) === to.slice(-2) ? `${from.slice(0, -3)}–${to}` : `${from}–${to}`;
}

/** Short meeting labels for a section row: ["Tue Thu 2:00–3:20 PM"], or ["Online"]. */
export function meetingLabels(meets: Meeting[]): string[] {
  const timed = meets.filter((m) => m.start);
  if (timed.length === 0) return [meets.length ? "Online, no set time" : "Time not listed"];
  return timed.map((m) => `${dayNames(m.days) || "TBA"} ${timeRange(m.start!, m.end)}`);
}

/** Distinct campus locations a section meets at, by name. */
export function meetingPlaces(meets: Meeting[]): string {
  const places = [...new Set(meets.filter((m) => m.start).map((m) => LOCATION_NAMES[m.campus] ?? m.campus))];
  return places.filter(Boolean).join(", ");
}

/** "AMIEL, DAVID" becomes "Amiel, David"; "O'BRIEN-SMITH" becomes "O'Brien-Smith". */
export function nameCase(name: string): string {
  return name.toLowerCase().replace(/(^|[\s,'-])([a-z])/g, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/** "12s ago", "5m ago", "3h ago", then a date. */
export function timeAgo(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return dateTime(iso);
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function duration(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  return `${(seconds / 3600).toFixed(1)} hr`;
}

/** Rutgers prerequisite notes contain markup such as <em>; show plain text only. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function hourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

const EXAM_ARRANGEMENTS = new Set(["By arrangement", "No final exam", "During class hour"]);

/**
 * Rutgers' exam field holds a scheduled date, an arrangement ("No final exam"),
 * a common-exam group ("Math") or a bare internal code ("U").
 */
export function examLabel(exam: string | null): string | null {
  if (!exam || /^[A-Z]$/.test(exam)) return null;
  if (EXAM_ARRANGEMENTS.has(exam) || /\d/.test(exam)) return exam;
  return `Common exam (${exam})`;
}
