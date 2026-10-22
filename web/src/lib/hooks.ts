import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { serverNow } from "../api/client";
import { useMeta } from "../api/hooks";
import type { TermInfo } from "../api/types";

/** Current time by the server's clock, refreshed on an interval, for "12s ago" labels. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * The selected term lives in the URL (?term=12027) so every view is shareable.
 * An unknown or missing term falls back to the server's default.
 */
export function useTerm(): {
  term: string | undefined;
  info: TermInfo | undefined;
  terms: TermInfo[];
  setTerm: (code: string) => void;
} {
  const { data } = useMeta();
  const [params, setParams] = useSearchParams();
  const terms = data?.terms ?? [];
  const requested = params.get("term");
  const term = terms.some((t) => t.code === requested) ? requested! : data?.defaultTerm;

  const setTerm = (code: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (code === data?.defaultTerm) next.delete("term");
        else next.set("term", code);
        return next;
      },
      { replace: true },
    );

  return { term, info: terms.find((t) => t.code === term), terms, setTerm };
}
