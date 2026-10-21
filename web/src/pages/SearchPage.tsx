import { useDeferredValue, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useCatalog, useHistory, useOpenSections } from "../api/hooks";
import type { Campus } from "../api/types";
import { CourseCard } from "../components/CourseCard";
import { Pagination } from "../components/Pagination";
import { DiscordPanel } from "../demo/DiscordPanel";
import { CAMPUSES, CAMPUS_NAMES, DAYS } from "../lib/config";
import { formatCount, plural } from "../lib/format";
import { useNow, useTerm } from "../lib/hooks";
import { filterCourses, prepareCourses, type Filters, type Sort } from "../lib/search";

const PAGE_SIZE = 20;
// With this few results, show their sections without a click.
const AUTO_EXPAND_UNDER = 4;
const SORTS: [Sort, string][] = [
  ["relevance", "Best match"],
  ["open", "Most open sections"],
  ["code", "Course code"],
];

function readFilters(params: URLSearchParams): Filters & { campus: Campus; page: number } {
  const campus = params.get("campus");
  const sort = params.get("sort");
  return {
    campus: CAMPUSES.includes(campus as Campus) ? (campus as Campus) : "NB",
    q: params.get("q") ?? "",
    core: params.get("core") ?? "",
    days: [...(params.get("days") ?? "")].filter((d) => "MTWHF".includes(d)).join(""),
    openOnly: params.get("open") === "1",
    hideSpn: params.get("spn") === "hide",
    sort: SORTS.some(([value]) => value === sort) ? (sort as Sort) : "relevance",
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

  const [toggledCourses, setToggledCourses] = useState<Set<string>>(new Set());
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const resultsTop = useRef<HTMLParagraphElement>(null);

  const prepared = useMemo(() => (catalog.data ? prepareCourses(catalog.data.courses) : []), [catalog.data]);
  const matches = useMemo(
    () =>
      filterCourses(
        prepared,
        {
          q: query,
          core: filters.core,
          days: filters.days,
          openOnly: filters.openOnly,
          hideSpn: filters.hideSpn,
          sort: filters.sort,
        },
        open.data?.indexes,
      ),
    [prepared, query, filters.core, filters.days, filters.openOnly, filters.hideSpn, filters.sort, open.data],
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

  const sectionCount = matches.reduce((n, m) => n + m.sections.length, 0);
  const openCount = open.data
    ? matches.reduce((n, m) => n + m.sections.filter((s) => open.data.indexes.has(s.index)).length, 0)
    : null;
  const coreCodes = Object.keys(catalog.data?.meta.coreCodes ?? {});
  const filtered = Boolean(filters.q || filters.core || filters.days || filters.openOnly || filters.hideSpn);

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
      <div className="filters" role="search">
        <label className="search-box">
          <span className="visually-hidden">Search</span>
          <input
            type="search"
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="Course, code, instructor or index"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="filter-row">
          <label>
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
          <label>
            <span className="visually-hidden">Core requirement</span>
            <select value={filters.core} onChange={(e) => update({ core: e.target.value || null })}>
              <option value="">Any core requirement</option>
              {coreCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <div className="toggle-group" role="group" aria-label="Meets on">
            {DAYS.map(([code, label]) => {
              const active = filters.days.includes(code);
              return (
                <button
                  key={code}
                  className="toggle"
                  aria-pressed={active}
                  onClick={() =>
                    update({
                      days:
                        [..."MTWHF"].filter((d) => (d === code ? !active : filters.days.includes(d))).join("") ||
                        null,
                    })
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
          <button
            className="toggle"
            aria-pressed={filters.openOnly}
            onClick={() => update({ open: filters.openOnly ? null : "1" })}
          >
            Open now
          </button>
          <button
            className="toggle"
            aria-pressed={filters.hideSpn}
            onClick={() => update({ spn: filters.hideSpn ? null : "hide" })}
          >
            Hide SPN
          </button>
          {filtered && (
            <button
              className="link-button"
              onClick={() => update({ q: null, core: null, days: null, open: null, spn: null })}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {catalog.isError ? (
        <p className="empty">The catalog could not be loaded. Retrying automatically.</p>
      ) : !catalog.data ? (
        <div className="skeleton-list" aria-label="Loading catalog" />
      ) : (
        <>
          <div className="results-bar">
            <p className="results-label" aria-live="polite" ref={resultsTop}>
              {matches.length
                ? `${plural(matches.length, "course")} · ${plural(sectionCount, "section")}${
                    openCount !== null ? ` · ${formatCount(openCount)} open` : ""
                  }`
                : "No sections match. Try fewer words or clear a filter."}
            </p>
            {matches.length > 1 && (
              <label className="sort">
                <span>Sort</span>
                <select
                  value={filters.sort}
                  onChange={(e) => update({ sort: e.target.value === "relevance" ? null : e.target.value })}
                >
                  {SORTS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="results">
            {shown.map(({ course, sections }) => {
              const autoExpand =
                matches.length < AUTO_EXPAND_UNDER || (exactIndex !== null && sections.some((s) => s.index === exactIndex));
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
