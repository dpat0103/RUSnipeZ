import { state } from "./state.js";
import { el } from "./dom.js";
import { DOT } from "./util.js";

export function setPulse(kind, text) {
  el.pulse.dataset.state = kind;
  el.pulseText.textContent = text;
}

export function tickClock() {
  if (el.pulse.dataset.state === "error" || !state.lastPollAt) return;
  const elapsed = Math.floor((Date.now() - state.lastPollAt) / 1000);
  setPulse("live", `live ${DOT} checked ${elapsed}s ago`);
}

