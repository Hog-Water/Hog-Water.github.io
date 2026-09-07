import { renderEntry, renderTable } from "./reference-renderer.mjs";

export const HOVER_OPEN_DELAY_MS = 100;
const POINTER_PANEL_GRACE_MS = 150;
const PANEL_FADE_MS = 150;
let previewNumber = 0;

function isReference(value) {
  return Boolean(value && typeof value.tableHref === "string" && value.tableHref.startsWith("/borkborg/tables/#"));
}

function isTouchEvent(event) {
  return event?.pointerType === "touch" || event?.pointerType === "pen";
}

function hasFocusWithin(node) {
  return node?.contains(document.activeElement);
}

function fallbackHref(reference) {
  if (isReference(reference)) return reference.tableHref;
  if (typeof reference?.tableId === "string" && /^[a-z0-9_]+$/.test(reference.tableId)) return `/borkborg/tables/#table-${reference.tableId}`;
  return "/borkborg/tables/";
}

function renderFallback(reference) {
  const article = document.createElement("article");
  article.className = "reference-preview-fallback";
  const heading = document.createElement("h2");
  heading.textContent = reference?.tableLabel ?? "Reference unavailable";
  const message = document.createElement("p");
  message.textContent = "The current source entry is unavailable. Open the full table to browse the published reference.";
  article.append(heading, message);
  const link = document.createElement("a");
  link.href = fallbackHref(reference);
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "Open full table in a new tab";
  article.append(link);
  return article;
}

function configureTableLinks(node, reference) {
  const fullTableLinks = [...node.querySelectorAll("a.reference-table-link")];
  if (fullTableLinks.length === 0) {
    const link = document.createElement("a");
    link.className = "reference-table-link";
    link.href = reference.tableHref;
    node.append(link);
    fullTableLinks.push(link);
  }
  for (const link of node.querySelectorAll('a[href^="/borkborg/tables/"]')) {
    link.target = "_blank";
    link.rel = "noopener";
    if (link.classList.contains("reference-table-link")) {
      link.textContent = "Open full table in a new tab";
    } else {
      link.setAttribute("aria-label", `Open result ${link.textContent} in Tables in a new tab`);
    }
  }
}

function removeCanonicalAnchorIds(node) {
  if (/^(table|result)-/.test(node.id)) node.removeAttribute("id");
  for (const anchor of node.querySelectorAll('[id^="table-"], [id^="result-"]')) {
    anchor.removeAttribute("id");
  }
}

function positionDesktop(panel, trigger) {
  const bounds = trigger.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const gap = 8;
  const width = Math.min(560, Math.max(280, viewportWidth - (gap * 2)));
  const left = Math.max(gap, Math.min(bounds.left, viewportWidth - width - gap));
  const minimumHeight = Math.min(144, Math.max(80, viewportHeight - (gap * 2)));
  const triggerTop = Number.isFinite(bounds.top) ? bounds.top : bounds.bottom;
  let top = bounds.bottom + gap;
  if (top + minimumHeight > viewportHeight - gap) {
    const preferredHeight = Math.min(320, viewportHeight - (gap * 2));
    top = Math.max(gap, Math.min(triggerTop - preferredHeight - gap, viewportHeight - minimumHeight - gap));
  }
  const maxHeight = Math.max(80, viewportHeight - top - gap);
  panel.style.setProperty("--reference-preview-left", `${left}px`);
  panel.style.setProperty("--reference-preview-top", `${Math.max(gap, top)}px`);
  panel.style.setProperty("--reference-preview-width", `${width}px`);
  panel.style.setProperty("--reference-preview-max-height", `${maxHeight}px`);
}

/**
 * Builds one nonmodal catalog-reference panel. The sheet integrator supplies a
 * resolved ReferenceView and, only in sheet context, an onChoose callback that
 * routes the renderer's row-specific request through its existing transaction.
 */
export function createReferencePreview({ lookup = null, onChoose = null } = {}) {
  const panelId = `reference-preview-${++previewNumber}`;
  const instructionId = `${panelId}-instructions`;
  let panel = null;
  let current = null;
  let currentTrigger = null;
  let pinned = false;
  let hoverTimer = null;
  let dismissTimer = null;
  let closeTimer = null;
  let openingFrame = null;
  let closingPanel = null;
  let destroyed = false;
  let restoringFocus = false;
  let instruction = null;
  const bindings = new Map();

  function ensureInstruction() {
    if (instruction?.isConnected) return instruction;
    instruction = document.createElement("span");
    instruction.id = instructionId;
    instruction.className = "reference-preview-instruction";
    instruction.textContent = "Reference preview available. Focus opens details. Press Enter or Space to pin its controls.";
    document.body.append(instruction);
    return instruction;
  }

  function syncExpanded() {
    for (const { trigger } of bindings.values()) {
      trigger.setAttribute("aria-expanded", String(trigger === currentTrigger && isOpen()));
    }
  }

  function clearTimers() {
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    if (dismissTimer !== null) clearTimeout(dismissTimer);
    hoverTimer = null;
    dismissTimer = null;
  }

  function finishClosing() {
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = null;
    closingPanel?.remove();
    closingPanel = null;
  }

  function isOpen() {
    return Boolean(panel?.isConnected);
  }

  function close({ restoreFocus = false } = {}) {
    clearTimers();
    if (openingFrame !== null) window.cancelAnimationFrame(openingFrame);
    openingFrame = null;
    const trigger = currentTrigger;
    const closing = panel;
    panel = null;
    current = null;
    currentTrigger = null;
    const shouldRestore = restoreFocus && trigger?.isConnected;
    pinned = false;
    syncExpanded();
    if (closing?.isConnected) {
      finishClosing();
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        closing.remove();
      } else {
      closing.classList.remove("reference-preview-opening");
      closing.classList.add("reference-preview-closing");
      closing.setAttribute("aria-hidden", "true");
      closing.inert = true;
      closingPanel = closing;
      closeTimer = setTimeout(finishClosing, PANEL_FADE_MS);
      }
    }
    if (shouldRestore) {
      restoringFocus = true;
      trigger.focus({ preventScroll: true });
      restoringFocus = false;
    }
  }

  function keepOpen() {
    if (dismissTimer !== null) clearTimeout(dismissTimer);
    dismissTimer = null;
  }

  function scheduleDismiss() {
    if (pinned || dismissTimer !== null) return;
    dismissTimer = setTimeout(() => {
      dismissTimer = null;
      if (!hasFocusWithin(currentTrigger) && !hasFocusWithin(panel)) close();
    }, POINTER_PANEL_GRACE_MS);
  }

  function resolve(reference) {
    if (!lookup) return reference;
    try {
      return lookup(reference);
    } catch {
      return null;
    }
  }

  function buildPanel(reference, trigger, mode) {
    const next = document.createElement("section");
    next.id = panelId;
    next.className = `reference-preview reference-preview--${mode}`;
    next.tabIndex = -1;
    next.setAttribute("role", "region");
    next.setAttribute("aria-label", `${reference?.tableLabel ?? "Reference"} preview`);
    const controls = document.createElement("div");
    controls.className = "reference-preview-controls";
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "reference-preview-close";
    closeButton.textContent = "Close reference";
    closeButton.addEventListener("click", () => close({ restoreFocus: true }));
    controls.append(closeButton);
    next.append(controls);

    const resolved = resolve(reference);
    if (isReference(resolved)) {
      const rendererOptions = onChoose ? { onChoose } : undefined;
      const content = resolved.resultKey === null ? renderTable(resolved, rendererOptions) : renderEntry(resolved, rendererOptions);
      removeCanonicalAnchorIds(content);
      configureTableLinks(content, resolved);
      next.append(content);
    } else {
      next.append(renderFallback(reference));
    }

    next.addEventListener("pointerenter", keepOpen);
    next.addEventListener("pointerleave", scheduleDismiss);
    next.addEventListener("focusin", keepOpen);
    next.addEventListener("focusout", scheduleDismiss);
    return next;
  }

  function open(reference, trigger, { mode = "desktop", pin = false } = {}) {
    if (destroyed || !trigger) return false;
    clearTimers();
    close();
    current = reference;
    currentTrigger = trigger;
    pinned = pin || mode === "bottom";
    panel = buildPanel(reference, trigger, mode);
    finishClosing();
    panel.classList.add("reference-preview-opening");
    document.body.append(panel);
    syncExpanded();
    if (mode === "desktop") positionDesktop(panel, trigger);
    const openingPanel = panel;
    openingFrame = window.requestAnimationFrame(() => {
      openingFrame = null;
      if (panel === openingPanel) openingPanel.classList.remove("reference-preview-opening");
    });
    if (mode === "bottom" || pin) panel.querySelector(".reference-preview-close").focus({ preventScroll: true });
    return true;
  }

  function scheduleOpen(reference, trigger) {
    clearTimers();
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      if (!destroyed && currentTrigger !== trigger && trigger.matches(":hover")) open(reference, trigger);
    }, HOVER_OPEN_DELAY_MS);
  }

  function bind(trigger, reference) {
    if (destroyed || !trigger || bindings.has(trigger)) return () => {};
    const previousAria = {
      controls: trigger.getAttribute("aria-controls"),
      describedBy: trigger.getAttribute("aria-describedby"),
      expanded: trigger.getAttribute("aria-expanded"),
    };
    const controls = new Set((previousAria.controls ?? "").split(/\s+/).filter(Boolean));
    controls.add(panelId);
    const descriptions = new Set((previousAria.describedBy ?? "").split(/\s+/).filter(Boolean));
    descriptions.add(instructionId);
    trigger.setAttribute("aria-controls", [...controls].join(" "));
    trigger.setAttribute("aria-describedby", [...descriptions].join(" "));
    trigger.setAttribute("aria-expanded", "false");
    ensureInstruction();
    let lastPointerType = null;
    const onPointerEnter = (event) => {
      if (!isTouchEvent(event)) scheduleOpen(reference, trigger);
    };
    const onPointerLeave = () => { if (!isOpen()) clearTimers(); else scheduleDismiss(); };
    const onFocus = () => {
      if (!restoringFocus) open(reference, trigger);
    };
    const onBlur = () => scheduleDismiss();
    const onPointerDown = (event) => { lastPointerType = event.pointerType; };
    const onClick = (event) => open(reference, trigger, { mode: isTouchEvent(event) || lastPointerType === "touch" || lastPointerType === "pen" ? "bottom" : "desktop", pin: true });
    const onKeyDown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open(reference, trigger, { pin: true });
      }
    };
    trigger.addEventListener("pointerenter", onPointerEnter);
    trigger.addEventListener("pointerleave", onPointerLeave);
    trigger.addEventListener("pointerdown", onPointerDown);
    trigger.addEventListener("focus", onFocus);
    trigger.addEventListener("blur", onBlur);
    trigger.addEventListener("click", onClick);
    trigger.addEventListener("keydown", onKeyDown);
    const unbind = () => {
      trigger.removeEventListener("pointerenter", onPointerEnter);
      trigger.removeEventListener("pointerleave", onPointerLeave);
      trigger.removeEventListener("pointerdown", onPointerDown);
      trigger.removeEventListener("focus", onFocus);
      trigger.removeEventListener("blur", onBlur);
      trigger.removeEventListener("click", onClick);
      trigger.removeEventListener("keydown", onKeyDown);
      for (const [name, value] of Object.entries(previousAria)) {
        const attribute = name === "describedBy" ? "aria-describedby" : `aria-${name}`;
        if (value === null) trigger.removeAttribute(attribute);
        else trigger.setAttribute(attribute, value);
      }
      bindings.delete(trigger);
      if (bindings.size === 0) {
        instruction?.remove();
        instruction = null;
      }
    };
    bindings.set(trigger, { trigger, unbind });
    return unbind;
  }

  function onDocumentPointerDown(event) {
    if (!isOpen() || panel.contains(event.target) || currentTrigger?.contains(event.target)) return;
    close({ restoreFocus: false });
  }

  function onDocumentKeyDown(event) {
    if (event.key === "Escape" && isOpen()) {
      event.preventDefault();
      close({ restoreFocus: pinned });
    }
  }

  function onViewportChange() {
    if (isOpen() && panel.classList.contains("reference-preview--desktop")) positionDesktop(panel, currentTrigger);
  }

  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  document.addEventListener("keydown", onDocumentKeyDown);
  window.addEventListener("resize", onViewportChange);
  window.visualViewport?.addEventListener("resize", onViewportChange);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    close();
    if (openingFrame !== null) window.cancelAnimationFrame(openingFrame);
    openingFrame = null;
    finishClosing();
    for (const { unbind } of [...bindings.values()]) unbind();
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    document.removeEventListener("keydown", onDocumentKeyDown);
    window.removeEventListener("resize", onViewportChange);
    window.visualViewport?.removeEventListener("resize", onViewportChange);
  }

  return { open, close, destroy, bind };
}
