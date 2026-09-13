import { proxy } from "./_soc.js";

export const onRequestGet = ({ request }) => proxy(request, "openSections.json");
