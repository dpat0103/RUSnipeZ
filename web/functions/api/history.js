import { historyProxy } from "../../../lib/history-proxy.js";

export const onRequestGet = ({ request, env }) => historyProxy(request, env.HISTORY_API_BASE);
