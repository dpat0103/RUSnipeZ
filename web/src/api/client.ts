import type {
  Campus,
  Catalog,
  Events,
  HistorySummary,
  Meta,
  OpenSections,
  SectionHistory,
  Stats,
} from "./types";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // Not JSON: keep the generic message.
    }
    throw new ApiError(response.status, detail);
  }
  return (await response.json()) as T;
}

export const api = {
  meta: (signal?: AbortSignal) => get<Meta>("/v1/meta", signal),
  stats: (signal?: AbortSignal) => get<Stats>("/v1/stats", signal),
  open: (term: string, signal?: AbortSignal) => get<OpenSections>(`/v1/terms/${term}/open`, signal),
  events: (term: string, signal?: AbortSignal) =>
    get<Events>(`/v1/terms/${term}/events?limit=40`, signal),
  history: (term: string, signal?: AbortSignal) =>
    get<HistorySummary>(`/v1/terms/${term}/history`, signal),
  section: (term: string, index: string, signal?: AbortSignal) =>
    get<SectionHistory>(`/v1/terms/${term}/sections/${index}`, signal),
  catalog: (term: string, campus: Campus, signal?: AbortSignal) =>
    get<Catalog>(`/v1/terms/${term}/catalogs/${campus}`, signal),
};
