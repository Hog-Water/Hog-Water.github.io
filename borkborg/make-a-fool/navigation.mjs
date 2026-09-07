/** Presentation-only navigation. The caller owns all character actions. */
export function createNavigation({ menuButton, drawer, sectionTargets = {}, actions = () => {} }) {
  if (!menuButton || !drawer || typeof drawer.showModal !== "function") {
    throw new TypeError("Navigation requires a menu button and native dialog");
  }
  const listeners = [];
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };
  let destroyed = false;
  let lastScrollY = menuButton.ownerDocument.defaultView.scrollY;
  let menuPlaceholder = null;
  let navigationClosePending = 0;
  menuButton.setAttribute("aria-haspopup", "dialog");
  menuButton.setAttribute("aria-controls", drawer.id);
  menuButton.setAttribute("aria-expanded", "false");

  function setMenuVisible(visible) {
    menuButton.classList.toggle("maf-menu-hidden", !visible);
  }
  function revealMenu() { setMenuVisible(true); }
  function mountMenuInDrawer() {
    if (menuButton.parentElement === drawer) return;
    menuPlaceholder = menuButton.ownerDocument.createComment("menu-button-home");
    menuButton.before(menuPlaceholder);
    drawer.append(menuButton);
    drawer.classList.add("maf-navigation-menu-mounted");
  }
  function restoreMenuHome() {
    if (menuButton.parentElement !== drawer) return;
    if (menuPlaceholder?.parentNode) menuPlaceholder.replaceWith(menuButton);
    else drawer.parentNode?.insertBefore(menuButton, drawer);
    menuPlaceholder = null;
    drawer.classList.remove("maf-navigation-menu-mounted");
  }
  function open() {
    if (destroyed || drawer.open) return;
    revealMenu();
    mountMenuInDrawer();
    try { drawer.showModal(); } catch (error) { restoreMenuHome(); throw error; }
    menuButton.setAttribute("aria-expanded", "true");
  }
  function close({ restoreFocus = true } = {}) {
    if (!drawer.open) return;
    navigationClosePending += 1;
    drawer.close();
    restoreMenuHome();
    menuButton.setAttribute("aria-expanded", "false");
    // Dialog close events are queued. Restore now so another action can safely
    // focus a sheet error or open import review without a late focus steal.
    if (restoreFocus && menuButton.isConnected) menuButton.focus({ preventScroll: true });
  }
  function toggle() { if (drawer.open) close(); else open(); }
  function onScroll() {
    const currentScrollY = menuButton.ownerDocument.defaultView.scrollY;
    const focused = menuButton.matches(":focus");
    if (drawer.open || focused || currentScrollY <= 24 || currentScrollY < lastScrollY) revealMenu();
    else if (currentScrollY > lastScrollY) setMenuVisible(false);
    lastScrollY = currentScrollY;
  }
  listen(menuButton.ownerDocument.defaultView, "scroll", onScroll, { passive: true });
  listen(menuButton, "focus", revealMenu);
  listen(menuButton, "click", toggle);
  listen(drawer, "cancel", (event) => { event.preventDefault(); close(); });
  listen(drawer, "keydown", (event) => {
    if (event.key !== "Tab") return;
    const stops = [...drawer.querySelectorAll("a[href], button, input, select, textarea, summary, [tabindex]")]
      .filter((node) => {
        const closedDetails = node.closest("details:not([open])");
        const summary = closedDetails?.querySelector(":scope > summary");
        return node.tabIndex >= 0 && !node.matches(":disabled") && node.getClientRects().length > 0
          && (!closedDetails || node === summary);
      });
    if (!stops.length) { event.preventDefault(); return; }
    const first = stops[0];
    const last = stops.at(-1);
    const focused = drawer.ownerDocument.activeElement;
    if (event.shiftKey && (focused === first || !drawer.contains(focused))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (focused === last || !drawer.contains(focused))) {
      event.preventDefault(); first.focus();
    }
  });
  listen(drawer, "close", () => {
    const navigationClose = navigationClosePending > 0;
    if (navigationClose) navigationClosePending -= 1;
    if (!drawer.open) {
      restoreMenuHome();
      menuButton.setAttribute("aria-expanded", "false");
      if (!navigationClose && menuButton.isConnected) menuButton.focus({ preventScroll: true });
    }
  });
  listen(drawer, "click", (event) => {
    const control = event.target.closest("[data-nav-close], [data-nav-action], [data-nav-section]");
    if (!control || !drawer.contains(control)) return;
    if (control.hasAttribute("data-nav-close")) { event.preventDefault(); close(); return; }
    // Modified link clicks retain native browser behavior. The integrator's
    // capture guard still protects invalid drafts before any link activation.
    if (control.matches("a") && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return;
    if (control.hasAttribute("data-nav-section")) {
      const key = control.dataset.navSection;
      const target = sectionTargets instanceof Map ? sectionTargets.get(key) : sectionTargets[key];
      if (!target) return;
      event.preventDefault();
      close({ restoreFocus: false });
      target.classList.add("maf-navigation-target");
      if (!target.matches("a, button, input, select, textarea, [tabindex]")) target.tabIndex = -1;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "start" });
    } else if (control.hasAttribute("data-nav-action")) {
      event.preventDefault();
      close();
      actions({ type: control.dataset.navAction, trigger: control });
    }
  });
  return {
    open, close, toggle,
    destroy() {
      if (destroyed) return;
      close();
      restoreMenuHome();
      destroyed = true;
      for (const remove of listeners) remove();
    },
  };
}
