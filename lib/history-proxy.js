// Compatibility for the original /api/history route. All public reads now
// use the prepared snapshot, never the collector's SQLite database.
export { snapshotProxy as historyProxy } from "./snapshot-proxy.js";
