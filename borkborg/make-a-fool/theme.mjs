const preferenceKey = "bork-borg.make-a-fool.theme";
const choices = new Set(["system", "light", "dark"]);
const picker = document.querySelector("#theme-choice");
const feedback = document.querySelector("#theme-feedback");
const system = globalThis.matchMedia("(prefers-color-scheme: dark)");
let preference = "system";

try {
  const saved = globalThis.localStorage.getItem(preferenceKey);
  if (choices.has(saved)) preference = saved;
} catch {
  // A blocked preference store must not block the sheet or its theme control.
}

function applyTheme() {
  document.documentElement.dataset.theme = preference === "system"
    ? (system.matches ? "dark" : "light")
    : preference;
  picker.value = preference;
}

picker.addEventListener("change", () => {
  preference = choices.has(picker.value) ? picker.value : "system";
  applyTheme();
  try {
    if (preference === "system") globalThis.localStorage.removeItem(preferenceKey);
    else globalThis.localStorage.setItem(preferenceKey, preference);
    feedback.hidden = true;
  } catch {
    feedback.textContent = "Theme changed for this visit. Your browser could not save the preference.";
    feedback.hidden = false;
  }
});
system.addEventListener("change", () => {
  if (preference === "system") applyTheme();
});
applyTheme();
