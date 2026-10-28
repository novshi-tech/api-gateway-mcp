// The only script the pages load: narrows the service picker as the user types.
// Pages work without it; the filter field stays hidden until this runs.
const APP_JS = `
const filter = document.getElementById("filter");
if (filter) {
  filter.closest("label").hidden = false;
  filter.addEventListener("input", () => {
    const query = filter.value.trim().toLowerCase();
    let any = false;
    for (const item of document.querySelectorAll("[data-search]")) {
      item.hidden = query !== "" && !item.dataset.search.includes(query);
      any ||= !item.hidden;
    }
    for (const group of document.querySelectorAll(".group")) {
      group.hidden = !group.querySelector("[data-search]:not([hidden])");
    }
    document.getElementById("no-match").hidden = any;
  });
}
`;

export const APP_JS_PATH = "/assets/app.js";

export function appJs(): Response {
  return new Response(APP_JS, {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
