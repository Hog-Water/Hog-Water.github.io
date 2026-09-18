export function createPlayEditMode({ sheet, controls, beforeChange = () => {}, onError = () => {}, isPlayable = () => false }) {
  let mode = "edit";
  let initialized = false;
  const activeControls = () => [...sheet.querySelectorAll("[data-field]")];
  const playable = (control) => /^(health\.hp\.current|resources\.|weapon\.ammo_die|weapon\.wear\.|possessions\.\d+\.wear\.)/.test(control.dataset.field);
  function apply(next) {
    mode = next;
    sheet.dataset.presentationMode = mode;
    sheet.ownerDocument.documentElement.dataset.presentationMode = mode;
    for (const control of activeControls()) {
      const editable = mode === "edit" || playable(control);
      if (control.type === "checkbox") control.disabled = !editable;
      else control.readOnly = !editable;
      control.toggleAttribute("data-play-locked", !editable);
    }
    for (const button of controls.querySelectorAll("[data-mode]")) button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  }
  function setMode(next) {
    if (next === mode) return;
    beforeChange(next);
    apply(next);
  }
  const onClick = (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button) return;
    try { setMode(button.dataset.mode); } catch (error) { onError(error); }
  };
  controls.addEventListener("click", onClick);
  return {
    sync() { if (!initialized) { initialized = true; apply(isPlayable() ? "play" : "edit"); } else apply(mode); },
    setMode,
    destroy() { controls.removeEventListener("click", onClick); },
    get mode() { return mode; },
  };
}
