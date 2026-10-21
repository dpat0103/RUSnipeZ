import { useDeferredValue, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useCatalog, useHistory, useOpenSections } from "../api/hooks";
import type { Campus, SectionFormat } from "../api/types";
import { CourseCard } from "../components/CourseCard";
import { Pagination } from "../components/Pagination";
import { DiscordPanel } from "../demo/DiscordPanel";
import { CAMPUSES, CAMPUS_NAMES, DAYS } from "../lib/config";
import { dayNames, formatCount, plural } from "../lib/format";
import { useNow, useTerm } from "../lib/hooks";
import { filterCourses, prepareCourses, type Filters, type Sort, type TimeOfDay } from "../lib/search";

const PAGE_SIZE = 20;
// With this few results, show their sections without a click.
const AUTO_EXPAND_UNDER = 4;

const SORTS: [Sort, string][] = [
  ["relevance", "Best match"],
  ["open", "Most open sections"],
  ["code", "Course code"],
];
const FORMATS: [SectionFormat, string][] = [
  ["in-person", "In person"],
  ["hybrid", "Hybrid"],
  ["online", "Online"],
];
const TIMES: [TimeOfDay, string][] = [
  ["morning", "Morning, before noon"],
  ["afternoon", "Afternoon, noon to 5 PM"],
  ["evening", "Evening, after 5 PM"],
];
const LEVELS: ["U" | "G", string][] = [
  ["U", "Undergraduate"],
  ["G", "Graduate"],
];
const CREDITS = ["1", "2", "3", "4+"];

/** URL parameters for the filters behind the Filters button. */
const MORE = ["dept", "core", "format", "time", "level", "credits", "honors", "spn"] as const;

const pick = <T extends string>(value: string | null, options: readonly T[]): T | "" =>
  options.includes(value as T) ? (value as T) : "";

function readFilters(params: URLSearchParams) {
  return {
    campus: (pick(params.get("campus"), CAMPUSES) || "NB") as Campus,
    q: params.get("q") ?? "",
    subject: params.get("dept") ?? "",
    core: params.get("core") ?? "",
    days: [...(params.get("days") ?? "")].filter((d) => "MTWHF".includes(d)).join(""),
    format: pick(params.get("format"), FORMATS.map(([v]) => v)),
    time: pick(params.get("time"), TIMES.map(([v]) => v)),
    level: pick(params.get("level"), LEVELS.map(([v]) => v)),
    credits: pick(params.get("credits"), CREDITS),
    honors: params.get("honors") === "1",
    openOnly: params.get("open") === "1",
    hideSpn: params.get("spn") === "hide",
    sort: (pick(params.get("sort"), SORTS.map(([v]) => v)) || "relevance") as Sort,
    page: Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1),
  };
}

export function SearchPage() {
  const { term, info } = useTerm();
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const query = useDeferredValue(filters.q);

  const catalog = useCatalog(term, filters.campus);
  const open = useOpenSections(term);
  const history = useHistory(term);
  const now = useNow(30_000);

  const [moreOpen, setMoreOpen] = useState(() => MORE.some((key) => params.has(key)));
  const [toggledCourses, setToggledCourses] = useState<Set<string>>(new Set());
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const resultsTop = useRef<HTMLDivElement>(null);

  const prepared = useMemo(() => (catalog.data ? prepareCourses(catalog.data.courses) : []), [catalog.data]);
  const departments = useMemo(() => {
    const names = new Map<string, string>();
    for (const course of catalog.data?.courses ?? []) names.set(course.subject, course.subjectName);
    return [...names].sort((a, b) => a[1].localeCompare(b[1]));
  }, [catalog.data]);

  const active: Filters = {
    q: query,
    subject: filters.subject,
    core: filters.core,
    days: filters.days,
    format: filters.format,
    time: filters.time,
    level: filters.level,
    credits: filters.credits,
    honors: filters.honors,
    openOnly: filters.openOnly,
    hideSpn: filters.hideSpn,
    sort: filters.sort,
  };
  const filterKey = JSON.stringify(active);
  const matches = useMemo(
    () => filterCourses(prepared, active, open.data?.indexes),
    // `active` is rebuilt every render; its serialized form is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prepared, filterKey, open.data],
  );

  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const page = Math.min(filters.page, pages);
  const shown = matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const exactIndex = /^\d{5}$/.test(filters.q.trim()) ? filters.q.trim() : null;

  const update = (changes: Record<string, string | null>) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        if (!("page" in changes)) next.delete("page");
        return next;
      },
      { replace: true },
    );
    setToggledCourses(new Set());
    setExpandedSection(null);
  };

  const goToPage = (next: number) => {
    update({ page: next === 1 ? null : String(next) });
    resultsTop.current?.scrollIntoView({ block: "start" });
  };

  const toggleCourse = (code: string) =>
    setToggledCourses((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  // Every active filter as a removable chip.
  const label = (options: [string, string][], value: string) => options.find(([v]) => v === value)?.[1] ?? value;
  const chips: [string, Record<string, null>][] = [];
  if (filters.openOnly) chips.push(["Open now", { open: null }]);
  if (filters.days) chips.push([dayNames(filters.days), { days: null }]);
  if (filters.subject) chips.push([label(departments, filters.subject), { dept: null }]);
  if (filters.core) chips.push([`Core ${filters.core}`, { core: null }]);
  if (filters.format) chips.push([label(FORMATS, filters.format), { format: null }]);
  if (filters.time) chips.push([label(TIMES, filters.time).split(",")[0]!, { time: null }]);
  if (filters.level) chips.push([label(LEVELS, filters.level), { level: null }]);
  if (filters.credits) chips.push([`${filters.credits} credits`, { credits: null }]);
  if (filters.honors) chips.push(["Honors", { honors: null }]);
  if (filters.hideSpn) chips.push(["No SPN", { spn: null }]);
  const moreCount = MORE.filter((key) => params.has(key)).length;

  const sectionCount = matches.reduce((n, m) => n + m.sections.length, 0);
  const openCount = open.data
    ? matches.reduce((n, m) => n + m.sections.filter((s) => open.data.indexes.has(s.index)).length, 0)
    : null;
  const coreCodes = Object.keys(catalog.data?.meta.coreCodes ?? {});

  return (
    <>
      <section className="page-head">
        <h1>Search sections</h1>
        <p className="lead">
          Live status for every section{info?.name ? ` in ${info.name}` : ""}, with when each one
          was last seen open.
        </p>
      </section>

      <div className="search-layout">
        <div className="search-main">
          <div className="filter-card" role="search">
            <div className="filter-top">
              <label className="search-box">
                <span className="visually-hidden">Search</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                </svg>
                <input
                  type="search"
                  value={filters.q}
                  onChange={(e) => update({ q: e.target.value })}
                  placeholder="Course, code, instructor or index"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="campus-select">
                <span className="visually-hidden">Campus</span>
                <select
                  value={filters.campus}
                  onChange={(e) => update({ campus: e.target.value === "NB" ? null : e.target.value })}
                >
                  {CAMPUSES.map((c) => (
                    <option key={c} value={c}>
                      {CAMPUS_NAMES[c]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="filter-row">
              <button
                className="toggle toggle-open"
                aria-pressed={filters.openOnly}
                onClick={() => update({ open: filters.openOnly ? null : "1" })}
              >
                Open now
              </button>
              <div className="toggle-group" role="group" aria-label="Meets on">
                {DAYS.map(([code, day]) => {
                  const on = filters.days.includes(code);
                  return (
                    <button
                      key={code}
                      className="toggle"
                      aria-pressed={on}
                      onClick={() =>
                        update({
                          days:
                            [..."MTWHF"].filter((d) => (d === code ? !on : filters.days.includes(d))).join("") ||
                            null,
                        })
                      }
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
              <button
                className="toggle toggle-more"
                aria-expanded={moreOpen}
                aria-controls="more-filters"
                onClick={() => setMoreOpen((v) => !v)}
              >
                Filters{moreCount ? ` · ${moreCount}` : ""}
              </button>
            </div>

            {moreOpen && (
              <div className="filter-grid" id="more-filters">
                <label>
                  <span>Department</span>
                  <select value={filters.subject} onChange={(e) => update({ dept: e.target.value || null })}>
                    <option value="">Any department</option>
                    {departments.map(([code, name]) => (
                      <option key={code} value={code}>
                        {name} ({code})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Core requirement</span>
                  <select value={filters.core} onChange={(e) => update({ core: e.target.value || null })}>
                    <option value="">Any core requirement</option>
                    {coreCodes.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Format</span>
                  <select value={filters.format} onChange={(e) => update({ format: e.target.value || null })}>
                    <option value="">Any format</option>
                    {FORMATS.map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Time of day</span>
                  <select value={filters.time} onChange={(e) => update({ time: e.target.value || null })}>
                    <option value="">Any time</option>
                    {TIMES.map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Level</span>
                  <select value={filters.level} onChange={(e) => update({ level: e.target.value || null })}>
                    <option value="">Any level</option>
                    {LEVELS.map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Credits</span>
                  <select value={filters.credits} onChange={(e) => update({ credits: e.target.value || null })}>
                    <option value="">Any credits</option>
                    {CREDITS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={filters.honors}
                    onChange={(e) => update({ honors: e.target.checked ? "1" : null })}
                  />
                  Honors sections only
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={filters.hideSpn}
                    onChange={(e) => update({ spn: e.target.checked ? "hide" : null })}
                  />
                  Hide sections needing a special permission number
                </label>
              </div>
            )}

            {chips.length > 0 && (
              <div className="active-filters" aria-label="Active filters">
                {chips.map(([text, clear]) => (
                  <button key={text} className="filter-chip" onClick={() => update(clear)} aria-label={`Remove ${text}`}>
                    {text}
                    <span aria-hidden="true">×</span>
                  </button>
                ))}
                <button
                  className="link-button"
                  onClick={() =>
                    update({ open: null, days: null, ...Object.fromEntries(MORE.map((key) => [key, null])) })
                  }
                >
                  Clear all
                </button>
              </div>
            )}
          </div>

          {catalog.isError ? (
            <p className="empty">The catalog could not be loaded. Retrying automatically.</p>
          ) : !catalog.data ? (
            <div className="skeleton-list" aria-label="Loading catalog" />
          ) : (
            <>
              <div className="results-bar" ref={resultsTop}>
                <p className="results-label" aria-live="polite">
                  {matches.length
                    ? `${plural(matches.length, "course")} · ${plural(sectionCount, "section")}${
                        openCount !== null ? ` · ${formatCount(openCount)} open` : ""
                      }`
                    : "No sections match. Try fewer words or remove a filter."}
                </p>
                {matches.length > 1 && (
                  <label className="sort">
                    <span>Sort</span>
                    <select
                      value={filters.sort}
                      onChange={(e) => update({ sort: e.target.value === "relevance" ? null : e.target.value })}
                    >
                      {SORTS.map(([value, text]) => (
                        <option key={value} value={value}>
                          {text}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <div className="results">
                {shown.map(({ course, sections }) => {
                  const autoExpand =
                    matches.length < AUTO_EXPAND_UNDER ||
                    (exactIndex !== null && sections.some((s) => s.index === exactIndex));
                  return (
                    <CourseCard
                      key={course.code}
                      term={term!}
                      course={course}
                      sections={sections}
                      open={open.data?.indexes}
                      history={history.data}
                      now={now}
                      expanded={autoExpand !== toggledCourses.has(course.code)}
                      onToggleCourse={() => toggleCourse(course.code)}
                      highlight={exactIndex}
                      expandedSection={expandedSection}
                      onToggleSection={(index) => setExpandedSection((current) => (current === index ? null : index))}
                    />
                  );
                })}
              </div>

              <Pagination page={page} pages={pages} onPage={goToPage} />
            </>
          )}
        </div>
        <DiscordPanel />
      </div>
    </>
  );
}
