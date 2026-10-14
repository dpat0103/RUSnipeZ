import { snapshotProxy } from "../../../lib/snapshot-proxy.js";

export const onRequestGet = ({ request, env }) => snapshotProxy(request, env.HISTORY_API_BASE);
