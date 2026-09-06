/** Portable boundary only. Live engine adoption is tracked separately in #207. */
import { validateDocument, validateCharacter, validateEvent, validateOperation } from "./generated/state-validator.mjs";

export const PORTABLE_FORMAT = "bork-borg.make-a-fool.state";
export const PORTABLE_VERSION = "0.0.2";
export const LEGACY_FORMAT = "bork-borg.make-a-fool.state.v1";

export class StateValidationError extends Error {
  constructor(errors) {
    super(errors.map(({ path, message }) => `${path || "/"}: ${message}`).join("; "));
    this.name = "StateValidationError";
    this.errors = errors;
  }
}

const escape = (key) => String(key).replaceAll("~", "~0").replaceAll("/", "~1");
function jsonErrors(value, path = "", ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return [];
  if (typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return [];
  if (typeof value !== "object" || value === null) return [{ path, message: "must be a JSON value (finite, safe numbers only)" }];
  if (ancestors.has(value)) return [{ path, message: "must not contain a cycle" }];
  if (Array.isArray(value) && Object.getPrototypeOf(value) !== Array.prototype) return [{ path, message: "must be a plain JSON array" }];
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return [{ path, message: "must be a plain JSON object" }];
  ancestors.add(value);
  const errors = [];
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value") || (Array.isArray(value) && (!/^(0|[1-9][0-9]*)$/.test(key) || !Number.isSafeInteger(Number(key)) || Number(key) >= value.length))) {
      errors.push({ path, message: "must contain only ordinary JSON properties" });
      continue;
    }
    errors.push(...jsonErrors(descriptor.value, `${path}/${escape(key)}`, ancestors));
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) errors.push({ path: `${path}/${index}`, message: "must not contain an array hole" });
  }
  ancestors.delete(value);
  return errors;
}

function schemaErrors(validator, value, prefix = "") {
  if (validator(value)) return [];
  return validator.errors.map(({ instancePath, message, params }) => ({
    path: `${prefix}${instancePath}${params.additionalProperty ? `/${escape(params.additionalProperty)}` : ""}`,
    message,
  }));
}
export function assertJson(value) {
  const errors = jsonErrors(value);
  if (errors.length) throw new StateValidationError(errors);
}
function assertSchema(validator, value, prefix = "") {
  const errors = schemaErrors(validator, value, prefix);
  if (errors.length) throw new StateValidationError(errors);
}

/** Recognition never guesses a version or performs migration. */
export function recognizeStateVersion(value) {
  if (value?.format === LEGACY_FORMAT && !Object.hasOwn(value, "version")) return "0.0.1";
  if (value?.format === PORTABLE_FORMAT && value.version === PORTABLE_VERSION) return PORTABLE_VERSION;
  throw new StateValidationError([{ path: "/version", message: `unsupported state format/version: ${String(value?.format)} / ${String(value?.version)}` }]);
}

/** Read-only validation; no coercion, defaults, removal, or live-state access. */
export function validateState(value) {
  const errors = jsonErrors(value);
  if (errors.length) return { valid: false, errors };
  try {
    const version = recognizeStateVersion(value);
    if (version !== PORTABLE_VERSION) return { valid: false, errors: [{ path: "/format", message: "legacy 0.0.1 requires explicit migration" }] };
  } catch (error) { return { valid: false, errors: error.errors }; }
  errors.push(...schemaErrors(validateDocument, value));
  const ids = new Set();
  if (errors.length === 0) {
    for (let index = 0; index < value.events.length; index++) {
      const event = value.events[index];
      if (ids.has(event.id)) errors.push({ path: `/events/${index}/id`, message: "duplicate event identity" });
      if (event.previousEvent !== undefined && !ids.has(event.previousEvent)) errors.push({ path: `/events/${index}/previousEvent`, message: "must reference an earlier event" });
      ids.add(event.id);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertState(value) {
  const result = validateState(value);
  if (!result.valid) throw new StateValidationError(result.errors);
  return value;
}

export function parseJSONDocument(text) {
  if (typeof text !== "string") throw new StateValidationError([{ path: "", message: "JSON input must be text" }]);
  let value;
  try { value = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { throw new StateValidationError([{ path: "", message: "invalid JSON" }]); }
  // JSON.parse alone silently accepts duplicate object names. Reject them before
  // either migration or restore can mistake the surviving member for all data.
  const tokens = text.replace(/^\uFEFF/, "").match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
  let cursor = 0;
  function visit(path) {
    const token = tokens[cursor++];
    if (token === "{") {
      const names = new Set();
      while (tokens[cursor] !== "}") {
        const name = JSON.parse(tokens[cursor++]);
        if (names.has(name)) throw new StateValidationError([{ path: `${path}/${escape(name)}`, message: "duplicate JSON property" }]);
        names.add(name);
        cursor++; // colon
        visit(`${path}/${escape(name)}`);
        if (tokens[cursor] === ",") cursor++;
      }
      cursor++;
    } else if (token === "[") {
      let index = 0;
      while (tokens[cursor] !== "]") {
        visit(`${path}/${index++}`);
        if (tokens[cursor] === ",") cursor++;
      }
      cursor++;
    }
  }
  visit("");
  assertJson(value);
  return value;
}

export function parseStateJSON(text) {
  return assertState(parseJSONDocument(text));
}

export function serializeStateJSON(value) {
  assertState(value);
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assign(target, { path, value }) {
  let current = target;
  for (let index = 0; index < path.length; index++) {
    const key = path[index];
    if (Array.isArray(current) !== (typeof key === "number")) throw new StateValidationError([{ path: `/${path.slice(0, index).map(escape).join("/")}`, message: "incompatible target container" }]);
    if (index === path.length - 1) current[key] = structuredClone(value);
    else {
      // Missing object-item slots need empty containers, not invented leaf
      // values. String-item gaps (Defects) remain invalid sparse state.
      if (Array.isArray(current) && typeof path[index + 1] === "string") {
        for (let slot = 0; slot < key; slot++) if (!Object.hasOwn(current, slot)) current[slot] = {};
      }
      if (!Object.hasOwn(current, key)) current[key] = typeof path[index + 1] === "number" ? [] : {};
      if (current[key] === null || typeof current[key] !== "object") throw new StateValidationError([{ path: `/${path.slice(0, index + 1).map(escape).join("/")}`, message: "cannot traverse a scalar" }]);
      current = current[key];
    }
  }
}

/** An atomic event returns a detached, serializable character or throws. */
export function applyEvent(character, event) {
  assertJson(character);
  assertJson(event);
  assertSchema(validateCharacter, character, "/character");
  assertSchema(validateEvent, event, "/event");
  const result = structuredClone(character);
  for (const operation of event.writes) assign(result, operation);
  assertJson(result);
  assertSchema(validateCharacter, result, "/character");
  return result;
}

/** Replay may temporarily contain holes; only the final valid snapshot escapes. */
export function replayEvents(events, initialCharacter = {}) {
  assertJson(events);
  assertJson(initialCharacter);
  assertSchema(validateCharacter, initialCharacter, "/character");
  if (!Array.isArray(events)) throw new StateValidationError([{ path: "/events", message: "must be an array" }]);
  const result = structuredClone(initialCharacter);
  for (const [index, event] of events.entries()) {
    assertSchema(validateEvent, event, `/events/${index}`);
    for (const operation of event.writes) {
      assertSchema(validateOperation, operation);
      assign(result, operation);
    }
  }
  assertJson(result);
  assertSchema(validateCharacter, result, "/character");
  return result;
}
