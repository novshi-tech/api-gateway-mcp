// The only script the pages load: narrows the service picker as the user types, shows
// the admin form's fields for one auth type, and copies values. Pages work without it.
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

// Copy buttons copy the value of the field they name; without the script the field is still selectable.
for (const button of document.querySelectorAll("[data-copy]")) {
  const field = document.getElementById(button.dataset.copy);
  if (!field || !navigator.clipboard) continue;
  button.hidden = false;
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(field.value);
    button.textContent = "コピーしました";
    setTimeout(() => { button.textContent = "コピー"; }, 2000);
  });
}

// The admin form shows only the fields of the chosen auth type.
const authTypes = document.querySelectorAll('input[name="auth_type"]');
if (authTypes.length > 0) {
  const show = () => {
    const chosen = document.querySelector('input[name="auth_type"]:checked')?.value;
    for (const section of document.querySelectorAll("[data-auth]")) section.hidden = section.dataset.auth !== chosen;
  };
  for (const input of authTypes) input.addEventListener("change", show);
  show();
}
`;

export const APP_JS_PATH = "/assets/app.js";

export function appJs(): Response {
  return new Response(APP_JS, {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
