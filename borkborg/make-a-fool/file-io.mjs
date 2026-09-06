import { prepareMarkdownDownload } from "./markdown-export.mjs";
import { serializeStateJSON } from "./state-contract.mjs";

/** One canonical payload from the current edited snapshot, with no I/O. */
export function prepareJSONDownload(state) {
  const text = serializeStateJSON(state);
  const name = [state.character.identity?.name?.firstName, state.character.identity?.name?.lastName]
    .filter(Boolean).join(" ").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 80).replace(/-$/g, "") || "unnamed";
  return { text, filename: `fool-${name}-${state.version}.json`, mimeType: "application/json;charset=utf-8" };
}

/** Requests a browser download; completion belongs to the browser/user. */
export function downloadFoolJSON(state, browser = globalThis) {
  // Validate before constructing a Blob, allocating a URL, or touching the DOM.
  return downloadPayload(prepareJSONDownload(state), browser, "JSON");
}

/** Validated readable export; JSON is the complete portable backup. */
export function downloadFoolMarkdown(state, browser = globalThis) {
  return downloadPayload(prepareMarkdownDownload(state), browser, "Markdown");
}

/** Raw recovery is deliberately not a validated current-format export. */
export function downloadRawBackup(text, browser = globalThis) {
  if (typeof text !== "string") throw new Error("No readable local payload is available for raw backup.");
  return downloadPayload({ text, filename: "fool-local-raw-backup.txt", mimeType: "text/plain;charset=utf-8" }, browser);
}

function downloadPayload(payload, browser, format = "raw backup") {
  if (!browser.document?.body || typeof browser.document.createElement !== "function"
      || typeof browser.Blob !== "function" || typeof browser.URL?.createObjectURL !== "function"
      || typeof browser.URL?.revokeObjectURL !== "function" || typeof browser.setTimeout !== "function") {
    throw new Error(`This browser cannot start a ${format} download. Keep the page open and try a current browser.`);
  }
  let url;
  let anchor;
  try {
    const blob = new browser.Blob([payload.text], { type: payload.mimeType });
    url = browser.URL.createObjectURL(blob);
    anchor = browser.document.createElement("a");
    anchor.href = url;
    anchor.download = payload.filename;
    anchor.hidden = true;
    browser.document.body.append(anchor);
    anchor.click();
  } catch {
    if (url) browser.URL.revokeObjectURL(url);
    throw new Error(`The browser could not start the ${format} download. Keep this page open and try Download ${format} again.`);
  } finally {
    anchor?.remove();
  }
  // Mobile browsers may consume the URL after this event returns. Revoke later,
  // not synchronously after click, while avoiding a retained URL per backup.
  browser.setTimeout(() => browser.URL.revokeObjectURL(url), 60_000);
  return { filename: payload.filename };
}

/** Coordinates asynchronous file reads without mutating the active character. */
export function createJSONImportSession(model) {
  let sequence = 0;
  let review = null;
  const changed = () => new Error("Your current Fool changed while the import was pending. Choose the JSON file again to review replacement.");
  function cancel() { sequence++; review = null; }

  async function read(file) {
    const token = ++sequence;
    review = null;
    if (!file) return { status: "canceled" };
    const baseline = model.serialize();
    let text;
    try {
      if (typeof file.text !== "function") throw new Error("File reading unavailable");
      text = await file.text();
    } catch {
      if (token !== sequence) return { status: "superseded" };
      throw new Error("The selected file could not be read. Choose an accessible JSON file and try again.");
    }
    if (token !== sequence) return { status: "superseded" };
    if (model.serialize() !== baseline) throw changed();
    const candidate = model.prepareRestore(text);
    review = { token, candidate, baseline };
    const name = candidate.character.identity?.name;
    return {
      status: "ready", token, filename: file.name || "JSON file",
      name: [name?.firstName, name?.lastName].filter(Boolean).join(" ") || "Unnamed Fool",
      version: candidate.version, outstandingDetails: candidate.unresolved.length,
    };
  }

  function replace(token) {
    if (!review || review.token !== token || sequence !== token) throw new Error("This import is no longer pending. Choose the JSON file again.");
    const pending = review;
    cancel();
    if (model.serialize() !== pending.baseline) throw changed();
    // The caller supplies the explicit UI decision through the model's existing
    // confirmation boundary. Validation and detachment still happen in restore.
    return model.restore(pending.candidate);
  }
  return { read, replace, cancel };
}
