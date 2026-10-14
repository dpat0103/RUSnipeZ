import { state } from "./state.js";

/**
 * Rutgers abbreviates course titles heavily ("MICROBIOL HLTH SCI",
 * "ADV ORGANIC CHEM I"), so the expanded form is added to the searchable text
 * and someone typing the full words still finds the course.
 */
export const ABBREVIATIONS = {
  adv: "advanced", amer: "american", anal: "analysis", appl: "applied",
  biol: "biology", chem: "chemistry", comp: "computer computational",
  dev: "development", econ: "economics", elem: "elementary", engr: "engineering",
  environ: "environmental", hist: "history", hlth: "health", intr: "introduction",
  intro: "introduction", interm: "intermediate", lang: "language", lit: "literature",
  math: "mathematics", mgmt: "management", microbiol: "microbiology", org: "organic",
  phys: "physics", prin: "principles", prob: "probability", psych: "psychology",
  sci: "science", stat: "statistics", struct: "structures", sys: "systems",
  thry: "theory", writ: "writing",
};

export function expandAbbreviations(title) {
  return title
    .toLowerCase()
    .split(/[^a-z]+/)
    .map((word) => ABBREVIATIONS[word] || "")
    .filter(Boolean)
    .join(" ");
}

// These match most of the catalogue and distort ranking if scored.
export const STOPWORDS = new Set(["to", "of", "the", "and", "in", "for", "a", "an", "i", "ii"]);

export function queryTerms(q) {
  const all = q.toLowerCase().split(/\s+/).filter(Boolean);
  const meaningful = all.filter((t) => !STOPWORDS.has(t));
  return meaningful.length ? meaningful : all;
}

/**
 * Tokens score independently and sum, rather than all being required, so
 * "expository writing" still finds COLLEGE WRITING. Matching every token
 * still ranks highest.
 */
export function score(course, terms) {
  let total = 0;
  let matched = 0;

  for (const term of terms) {
    let best = 0;
    if (course._indexes.has(term)) best = 1000;
    else if (course._code.includes(term)) best = 60;
    else if (course._title.includes(term)) {
      best = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(course._title)
        ? 40
        : 22;
    } else if (course._who.includes(term)) best = 30;
    else if (course._subject.includes(term)) best = 12;

    if (best > 0) matched += 1;
    total += best;
  }

  if (matched === 0) return 0;
  if (matched === terms.length) total *= 2;
  // Break ties toward courses that actually offer many sections, capped so it
  // can never outweigh a real token match.
  return total + Math.min(15, Math.log2(1 + course.sections.length) * 2.2);
}

export function filtered() {
  const { q, core, loc, days, openOnly, hideSpn, sort } = state.filters;
  const terms = queryTerms(q);
  const dayFilter = [...days];

  const out = [];
  for (const course of state.courses) {
    if (core && !course.core.includes(core)) continue;

    let relevance = 0;
    if (terms.length) {
      relevance = score(course, terms);
      if (relevance === 0) continue;
    }

    const sections = course.sections.filter((s) => {
      if (hideSpn && s.spn) return false;
      if (openOnly && state.seenBaseline && !state.open.has(s.index)) return false;
      if (loc && !s._locs.has(loc)) return false;
      if (dayFilter.length && !dayFilter.every((d) => s._days.has(d))) return false;
      return true;
    });
    if (sections.length === 0) continue;
    out.push({ course, sections, relevance });
  }

  const openCount = (row) => row.sections.filter((s) => state.open.has(s.index)).length;
  const byCode = (a, b) => a.course.code.localeCompare(b.course.code);

  if (sort === "open") out.sort((a, b) => openCount(b) - openCount(a) || byCode(a, b));
  else if (sort === "code") out.sort(byCode);
  else if (sort === "sections") out.sort((a, b) => b.sections.length - a.sections.length || byCode(a, b));
  else if (terms.length) out.sort((a, b) => b.relevance - a.relevance || byCode(a, b));
  else out.sort(byCode);

  return out;
}

