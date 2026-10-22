import { queryOptions, useQuery } from "@tanstack/react-query";
import { api, serverNow } from "./client";
import type { Campus, Meta, OpenSections } from "./types";

// Refresh intervals follow the server's 30 second polling cadence.
const LIVE_MS = 15_000;
const HISTORY_MS = 60_000;

// Margin after a check is due before asking for it: the check itself takes a
// moment, and the CDN may still hold the previous answer for a few seconds.
const CHECK_MARGIN_MS = 3_000;
const RETRY_MS = 2_000;

/**
 * Fetch meta again just after the next check is due rather than on a fixed
 * timer, so the header's "checked 12s ago" rarely runs past the 30 second
 * cadence. Until the new check shows up, retry every couple of seconds.
 */
export function nextMetaRefetch(meta: Meta | undefined, now: number): number {
  const last = Math.max(0, ...(meta?.terms ?? []).map((t) => (t.lastPollAt ? Date.parse(t.lastPollAt) : 0)));
  if (!meta || last === 0) return LIVE_MS;
  const due = last + meta.pollSeconds * 1000 + CHECK_MARGIN_MS - now;
  return Math.min(LIVE_MS, Math.max(RETRY_MS, due));
}

// Query definitions are shared so every caller hits the same cache entry.
export const metaQuery = () =>
  queryOptions({
    queryKey: ["meta"],
    queryFn: ({ signal }) => api.meta(signal),
    refetchInterval: (query) => nextMetaRefetch(query.state.data, serverNow()),
  });

export const statsQuery = () =>
  queryOptions({ queryKey: ["stats"], queryFn: ({ signal }) => api.stats(signal), refetchInterval: LIVE_MS });

// Module-level so TanStack Query reuses the selected value until the data changes.
const toOpenSet = (data: OpenSections) => ({ observedAt: data.observedAt, indexes: new Set(data.indexes) });

export const openSectionsQuery = (term: string) =>
  queryOptions({
    queryKey: ["open", term],
    queryFn: ({ signal }) => api.open(term, signal),
    refetchInterval: LIVE_MS,
    select: toOpenSet,
  });

export const sectionQuery = (term: string, index: string) =>
  queryOptions({
    queryKey: ["section", term, index],
    queryFn: ({ signal }) => api.section(term, index, signal),
    staleTime: HISTORY_MS,
  });

export const catalogQuery = (term: string, campus: Campus) =>
  queryOptions({
    queryKey: ["catalog", term, campus],
    queryFn: ({ signal }) => api.catalog(term, campus, signal),
    // Catalogs change a few times a day; the server revalidates by ETag.
    staleTime: 30 * 60_000,
  });

export function useMeta() {
  return useQuery(metaQuery());
}

export function useStats() {
  return useQuery(statsQuery());
}

export function useOpenSections(term: string | undefined) {
  return useQuery({ ...openSectionsQuery(term ?? ""), enabled: Boolean(term) });
}

export function useEvents(term: string | undefined) {
  return useQuery({
    queryKey: ["events", term],
    queryFn: ({ signal }) => api.events(term!, signal),
    enabled: Boolean(term),
    refetchInterval: LIVE_MS,
  });
}

export function useHistory(term: string | undefined) {
  return useQuery({
    queryKey: ["history", term],
    queryFn: ({ signal }) => api.history(term!, signal),
    enabled: Boolean(term),
    refetchInterval: HISTORY_MS,
  });
}

export function useSection(term: string, index: string) {
  return useQuery(sectionQuery(term, index));
}

export function useCatalog(term: string | undefined, campus: Campus) {
  return useQuery({ ...catalogQuery(term ?? "", campus), enabled: Boolean(term) });
}
