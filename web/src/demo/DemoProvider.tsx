import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { catalogQuery, openSectionsQuery, sectionQuery, statsQuery } from "../api/hooks";
import type { Catalog, OpenSections } from "../api/types";
import { CAMPUSES } from "../lib/config";
import { useTerm } from "../lib/hooks";
import { DemoContext, type DemoApi } from "./context";
import {
  loadState,
  newlyOpened,
  parseCommand,
  reducer,
  sameWatch,
  saveState,
  snipeResult,
  watchFrom,
  type Reply,
  type Watch,
} from "./model";

const HOUR_MS = 3600_000;

export function DemoProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const { term, info } = useTerm();
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => saveState(state), [state]);

  // Live status for every term with a watch, from the same cache the pages use.
  const watchedTerms = useMemo(() => [...new Set(state.watches.map((w) => w.term))], [state.watches]);
  const openQueries = useQueries({ queries: watchedTerms.map((t) => openSectionsQuery(t)) });
  const openByTerm = useMemo(
    () => new Map(watchedTerms.map((t, i) => [t, openQueries[i]?.data?.indexes])),
    // Rebuild only when some term's open set changed. Structural sharing keeps
    // the same data object when a refetch returns identical content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [watchedTerms, ...openQueries.map((q) => q.data)],
  );

  const post = useCallback(
    (command: string | null, reply: Reply) => dispatch({ type: "post", command, reply, at: Date.now() }),
    [],
  );

  // A watched section that opens while the tab is open gets the real alert.
  const lastSeen = useRef(new Map<string, boolean>());
  useEffect(() => {
    const { alerts, next } = newlyOpened(lastSeen.current, state.watches, openByTerm, Date.now());
    lastSeen.current = next;
    for (const watch of alerts) post(null, { type: "alert", watch, preview: false, handled: null });
  }, [openByTerm, state.watches, post]);

  const isOpen = useCallback(
    (watch: { term: string; index: string }) => {
      const live = openByTerm.get(watch.term);
      if (live) return live.has(watch.index);
      // A term with no watches yet: use whatever the pages already fetched.
      const cached = client.getQueryData<OpenSections>(["open", watch.term]);
      return cached ? cached.indexes.includes(watch.index) : null;
    },
    [openByTerm, client],
  );

  /** Every campus catalog for a term, loading any that are not cached yet. */
  const catalogs = useCallback(
    async (code: string): Promise<Catalog[]> =>
      (await Promise.allSettled(CAMPUSES.map((c) => client.ensureQueryData(catalogQuery(code, c)))))
        .filter((r): r is PromiseFulfilledResult<Catalog> => r.status === "fulfilled")
        .map((r) => r.value),
    [client],
  );

  const api = useMemo<DemoApi>(() => {
    const termName = info?.name ?? term ?? "";

    const snipe = (watch: Watch) => {
      const result = snipeResult(state.watches, watch);
      if (result === "added") dispatch({ type: "add-watch", watch });
      post(`/snipe ${watch.index}`, {
        type: "snipe",
        watch,
        result,
        openNow: isOpen(watch),
        count: state.watches.length + (result === "added" ? 1 : 0),
      });
      setPanelOpen(true);
    };

    const remove = (index: string, watchTerm = term) => {
      const watch = state.watches.find((w) => w.term === watchTerm && w.index === index) ?? null;
      if (watch) dispatch({ type: "remove-watch", term: watch.term, index });
      post(`/remove ${index}`, { type: "remove", index, watch });
    };

    const findSection = async (index: string) => {
      for (const catalog of await catalogs(term!)) {
        for (const course of catalog.courses) {
          const section = course.sections.find((s) => s.index === index);
          if (section) return watchFrom(term!, termName, course, section);
        }
      }
      return null;
    };

    const run = async (text: string) => {
      const typed = text.trim();
      const command = parseCommand(typed);
      if ("error" in command) return post(typed, { type: "error", text: command.error });
      if (!term) return post(typed, { type: "error", text: "Live data is still loading. Try again in a moment." });

      switch (command.name) {
        case "snipe": {
          const watch = await findSection(command.index);
          if (watch) snipe(watch);
          else post(typed, { type: "not-found", what: `index ${command.index} in ${termName}` });
          return;
        }
        case "remove":
          return remove(command.index);
        case "lastopen":
          return lastopen(command.index);
        case "course":
          return course(command.code);
        case "check":
          return check();
        case "clear":
          return clear();
        case "status":
          return status();
        case "help":
          return post("/help", { type: "help" });
      }
    };

    const check = () =>
      post("/check", {
        type: "check",
        rows: [...state.watches]
          .map((watch) => ({ watch, open: isOpen(watch) }))
          .sort((a, b) => Number(Boolean(b.open)) - Number(Boolean(a.open))),
      });

    const clear = () => post("/clear", { type: "clear-confirm", count: state.watches.length, resolution: "pending" });

    const lastopen = async (index: string) => {
      const command = `/lastopen ${index}`;
      try {
        const history = await client.fetchQuery(sectionQuery(term!, index));
        post(command, {
          type: "lastopen",
          term: term!,
          index,
          title: history.courseTitle,
          sectionNumber: history.sectionNumber,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          post(command, { type: "not-found", what: `index ${index} in ${termName}` });
        } else {
          post(command, { type: "error", text: "Seat history is unavailable right now." });
        }
      }
    };

    const course = async (code: string) => {
      for (const catalog of await catalogs(term!)) {
        const found = catalog.courses.find((c) => c.code === code);
        if (found) {
          return post(`/course ${code}`, {
            type: "course",
            termName,
            code,
            title: found.title,
            campus: catalog.meta.campus,
            sections: found.sections.map((s) => ({
              index: s.index,
              number: s.number,
              instructors: s.instructors,
              open: isOpen({ term: term!, index: s.index }),
            })),
          });
        }
      }
      post(`/course ${code}`, { type: "not-found", what: `${code} in ${termName}` });
    };

    const status = async () => {
      const stats = await client.fetchQuery(statsQuery()).catch(() => null);
      post("/status", { type: "status", stats });
    };

    return {
      state,
      term,
      panelOpen,
      setPanelOpen,
      isOpen,
      isWatched: (index: string) => state.watches.some((w) => term !== undefined && sameWatch(w, { term, index })),
      snipe,
      remove,
      run,
      check,
      clear,
      lastopen,
      course,
      status,
      help: () => post("/help", { type: "help" }),
      resolveClear: (id: number, confirmed: boolean) => {
        if (confirmed) dispatch({ type: "clear-watches" });
        dispatch({ type: "resolve-clear", id, confirmed });
      },
      previewAlert: (watch: Watch) => post(null, { type: "alert", watch, preview: true, handled: null }),
      handleAlert: (id: number, watch: Watch, action: "snoozed" | "stopped" | "got-in") => {
        if (action === "snoozed") {
          dispatch({ type: "snooze", term: watch.term, index: watch.index, until: Date.now() + HOUR_MS });
        } else {
          // "I got in" also drops the cross-listed copies of the same class.
          const indexes = action === "got-in" ? [watch.index, ...watch.crossListed] : [watch.index];
          for (const index of indexes) dispatch({ type: "remove-watch", term: watch.term, index });
        }
        dispatch({ type: "alert-handled", id, handled: action });
      },
      reset: () => dispatch({ type: "reset" }),
    };
  }, [state, term, info, panelOpen, isOpen, post, catalogs, client]);

  return <DemoContext.Provider value={api}>{children}</DemoContext.Provider>;
}
