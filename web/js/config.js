export const TERM = "02027";
export const TERM_NAME = "Winter 2027";
export const CAMPUS_NAMES = { NB: "New Brunswick", NK: "Newark", CM: "Camden" };

// The endpoint declares Cache-Control: max-age=30, so a faster cycle cannot
// surface anything this one would miss.
export const POLL_SECONDS = 30;
export const PAGE_SIZE = 40;
export const MAX_EVENTS = 60;
export const WEBREG = `https://sims.rutgers.edu/webreg/editSchedule.htm?login=cas&semesterSelection=${TERM}&indexList=`;
export const STORAGE_KEY = `rusnipez.watch.v2.${TERM}`;

export const INTRO_KEY = "rusnipez.intro.dismissed.v1";

export const LOCATION_NAMES = {
  CAC: "College Avenue",
  BUS: "Busch",
  LIV: "Livingston",
  "D/C": "Cook / Douglass",
  ONL: "Online",
  DNB: "Downtown New Brunswick",
  OFF: "Off campus",
};

export const DEFAULT_FILTERS = {
  q: "",
  core: "",
  loc: "",
  days: "",
  openOnly: false,
  hideSpn: false,
  sort: "relevance",
};
