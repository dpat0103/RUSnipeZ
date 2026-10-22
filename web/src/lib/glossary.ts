/** Rutgers and RU SnipeZ terms, shown in the search page's tag guide and on How it works. */

export interface Term {
  /** What the student sees: a tag's text or the term itself. */
  label: string;
  /** Class names that draw the label exactly as it appears on a section. */
  look?: string;
  meaning: string;
}

/** Tags on a section row, in the order they appear. */
export const TAGS: Term[] = [
  { label: "Open", look: "pill pill-opened", meaning: "A seat is free in WebReg, as of the latest check." },
  { label: "Closed", look: "pill pill-closed", meaning: "Full. Snipe it to hear the moment a seat frees up." },
  {
    label: "SPN",
    look: "badge badge-spn",
    meaning:
      "Special permission number. Even with a free seat, you need a number from the department to register.",
  },
  {
    label: "XL",
    look: "badge badge-xl",
    meaning: "Cross-listed. The same class is also offered under another course code, with its own index and seats.",
  },
  {
    label: "Restricted",
    look: "badge badge-restricted",
    meaning: "Only some students can register, such as certain class years or majors. Open the section to see who.",
  },
  { label: "Honors", look: "badge badge-honors", meaning: "An honors section, usually limited to honors program students." },
  { label: "Online", look: "badge badge-format", meaning: "Every meeting is online." },
  { label: "Hybrid", look: "badge badge-format", meaning: "Some meetings are online and some in person." },
  { label: "Watching", look: "badge badge-watch", meaning: "You are sniping this section in the Discord preview." },
];

/** Words and numbers that are not tags. */
export const TERMS: Term[] = [
  {
    label: "Index",
    look: "index",
    meaning:
      "The five-digit number for one section, such as 25596. WebReg registers you by index, and /snipe watches one.",
  },
  {
    label: "01:198:111",
    look: "course-code",
    meaning: "A course code: school 01, subject 198 (Computer Science), course 111. Every section of a course shares it.",
  },
  { label: "Sec 03", look: "section-number", meaning: "The section number within a course. Each section has its own index." },
  {
    label: "Seen open 3h ago",
    meaning: "The last time a check found a free seat in this section. Sections that open often are worth sniping.",
  },
  {
    label: "~2m ago",
    meaning: "Approximate. The change happened during a gap in checks, so its exact time is unknown.",
  },
];

/**
 * School of Arts and Sciences core curriculum codes. Other schools' codes
 * (such as CE or SOEHS) also appear on courses; their meaning is set by that school.
 */
export const CORE_CODES: [string, string][] = [
  ["AHo", "Arts and humanities: philosophical and theoretical issues"],
  ["AHp", "Arts and humanities: arts and literatures"],
  ["AHq", "Arts and humanities: human languages"],
  ["AHr", "Arts and humanities: creative expression"],
  ["CCD", "Contemporary challenges: diversities and social inequalities"],
  ["CCO", "Contemporary challenges: our common future"],
  ["HST", "Historical analysis"],
  ["SCL", "Social analysis"],
  ["NS", "Natural sciences"],
  ["QQ", "Quantitative information"],
  ["QR", "Quantitative and formal reasoning"],
  ["ITR", "Information technology and research"],
  ["WC", "Writing and communication: college writing"],
  ["WCr", "Writing and communication: revision"],
  ["WCd", "Writing and communication: writing in a discipline"],
];
