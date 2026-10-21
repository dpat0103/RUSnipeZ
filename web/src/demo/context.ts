import { createContext, useContext } from "react";
import type { DemoState, Watch } from "./model";

export interface DemoApi {
  state: DemoState;
  term: string | undefined;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  isOpen: (watch: { term: string; index: string }) => boolean | null;
  isWatched: (index: string) => boolean;
  snipe: (watch: Watch) => void;
  remove: (index: string, term?: string) => void;
  run: (text: string) => Promise<void>;
  check: () => void;
  clear: () => void;
  lastopen: (index: string) => Promise<void>;
  course: (code: string) => Promise<void>;
  status: () => Promise<void>;
  help: () => void;
  resolveClear: (id: number, confirmed: boolean) => void;
  previewAlert: (watch: Watch) => void;
  handleAlert: (id: number, watch: Watch, action: "snoozed" | "stopped" | "got-in") => void;
  reset: () => void;
}

export const DemoContext = createContext<DemoApi | null>(null);

export function useDemo(): DemoApi {
  const api = useContext(DemoContext);
  if (!api) throw new Error("useDemo must be used inside DemoProvider");
  return api;
}
