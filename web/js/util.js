import { el } from "./dom.js";

export const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

export const num = (n) => n.toLocaleString("en-US");
export const DOT = "·";

/** "15:50" becomes "3:50 PM" */
export function clock(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function meetingText(meets) {
  if (!meets || meets.length === 0) return "No meeting time listed";
  return meets
    .map((m) => {
      const when = m.start ? `${m.days || "TBA"} ${clock(m.start)}-${clock(m.end)}` : "Async";
      const where = [m.where, m.campus].filter(Boolean).join(` ${DOT} `);
      return where ? `${when} ${DOT} ${where}` : when;
    })
    .join("  |  ");
}

export const timeLabel = (date) => date.toLocaleTimeString("en-US", { hour12: false });

let toastTimer;
export function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 2600);
}

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
