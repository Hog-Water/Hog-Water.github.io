import { prepareSupportedState } from "./compatibility.mjs";
import { serializeStateJSON } from "./state-contract.mjs";

export const FOOL_STORAGE_KEY = "bork-borg.make-a-fool.current";

/** One validated Fool, with protected raw recovery and optimistic tab ownership. */
export function createLocalRecovery({ getStorage = () => globalThis.localStorage, key = FOOL_STORAGE_KEY } = {}) {
  let raw = null;
  let inspected = false;
  let protectedPayload = false;
  let savedText = null;
  let result = { status: "empty", message: "No Fool saved in this browser yet. Valid edits save automatically; keep JSON backups too." };
  const report = (status, message, extra = {}) => (result = { status, message, ...extra });
  function inspect() {
    inspected = true;
    try { raw = getStorage().getItem(key); }
    catch {
      protectedPayload = true;
      return report("unavailable", "Browser storage could not be read. Existing saved data has not been changed. Edits remain in this tab only; Download JSON to keep them.");
    }
    if (raw === null) { protectedPayload = false; return result; }
    try {
      const state = prepareSupportedState(raw);
      savedText = serializeStateJSON(state);
      protectedPayload = false;
      return report("supported", "Saved Fool restored from this browser. Valid edits save automatically; keep JSON backups too.", { state });
    } catch (error) {
      protectedPayload = true;
      return report("protected", `Saved data was not restored. ${error.message} The original local payload is preserved. Download a raw backup before choosing Start new. Edits remain in this tab only.`);
    }
  }
  function checkCurrent(storage) {
    const actual = storage.getItem(key);
    if (actual === raw) return true;
    raw = actual;
    protectedPayload = true;
    report("conflict", "Saved data changed in another tab. Autosave has stopped to preserve that data. Download the current Fool as JSON and any available raw saved backup before reloading or explicitly resetting saved data.");
    return false;
  }
  function save(state) {
    if (!inspected) throw new Error("Inspect saved data before saving a Fool.");
    if (protectedPayload) return result;
    // Validate before touching storage, even for a repeated snapshot.
    const text = serializeStateJSON(prepareSupportedState(state));
    try {
      const storage = getStorage();
      if (!checkCurrent(storage)) return result;
      if (text === savedText) return result;
      storage.setItem(key, text);
      raw = text;
      savedText = text;
      if (!checkCurrent(storage)) return result;
      return report("saved", "Saved in this browser. Keep a JSON backup for another browser or device, and before clearing site data.");
    } catch {
      return report("write-failed", "Autosave failed: browser storage is unavailable or full. Your current edits remain in this tab only. Download JSON to keep them; the next edit will retry saving.");
    }
  }
  function checkExternal() {
    if (!inspected || protectedPayload) return result;
    try { checkCurrent(getStorage()); }
    catch { protectedPayload = true; report("unavailable", "Browser storage could not be checked. Autosave has stopped. Download JSON to keep current edits, then reload to retry."); }
    return result;
  }
  function reset() {
    if (!inspected || !protectedPayload || raw === null) throw new Error("No readable protected payload is available to reset.");
    const storage = getStorage();
    if (storage.getItem(key) !== raw) throw new Error("Saved data changed in another tab. Reload and review that data before resetting.");
    storage.removeItem(key);
    raw = null;
    savedText = null;
    protectedPayload = false;
    return report("empty", "Preserved local payload removed at your request. The current Fool can now be saved in this browser.");
  }
  return { inspect, save, checkExternal, reset, status: () => result, rawBackup: () => raw, isProtected: () => protectedPayload };
}
