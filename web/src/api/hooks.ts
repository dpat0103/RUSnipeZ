import { queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "./client";
import type { Campus, OpenSections } from "./types";

// Refresh intervals follow the server's 30 second polling cadence.
const LIVE_MS = 15_000;
const HISTORY_MS = 60_000;

// Query definitions are shared so every caller hits the same cache entry.
export const metaQuery = () =>
  queryOptions({ queryKey: ["meta"], queryFn: ({ signal }) => api.meta(signal), refetchInterval: LIVE_MS });

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
