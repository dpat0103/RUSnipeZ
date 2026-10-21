import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import type { Campus } from "./types";

// Refresh intervals follow the server's 30 second polling cadence.
const LIVE_MS = 15_000;
const HISTORY_MS = 60_000;

export function useMeta() {
  return useQuery({
    queryKey: ["meta"],
    queryFn: ({ signal }) => api.meta(signal),
    refetchInterval: LIVE_MS,
  });
}

export function useStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: ({ signal }) => api.stats(signal),
    refetchInterval: LIVE_MS,
  });
}

export function useOpenSections(term: string | undefined) {
  return useQuery({
    queryKey: ["open", term],
    queryFn: ({ signal }) => api.open(term!, signal),
    enabled: Boolean(term),
    refetchInterval: LIVE_MS,
    select: (data) => ({ observedAt: data.observedAt, indexes: new Set(data.indexes) }),
  });
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
  return useQuery({
    queryKey: ["section", term, index],
    queryFn: ({ signal }) => api.section(term, index, signal),
    staleTime: HISTORY_MS,
  });
}

export function useCatalog(term: string | undefined, campus: Campus) {
  return useQuery({
    queryKey: ["catalog", term, campus],
    queryFn: ({ signal }) => api.catalog(term!, campus, signal),
    enabled: Boolean(term),
    // Catalogs change a few times a day; the server revalidates by ETag.
    staleTime: 30 * 60_000,
  });
}
