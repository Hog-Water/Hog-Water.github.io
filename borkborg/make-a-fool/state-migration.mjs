import { assertJson, assertState, parseJSONDocument, recognizeStateVersion, replayEvents, StateValidationError } from "./state-contract.mjs";
import { fieldPath } from "./field-adapter.mjs";

const fail = (path, message) => { throw new StateValidationError([{ path, message }]); };
const pointer = (key) => key.replaceAll("~", "~0").replaceAll("/", "~1");

function legacyWrites(writes, previous, location) {
  if (!writes || typeof writes !== "object" || Array.isArray(writes)) fail(location, "legacy fields must be an object");
  const combined = { ...previous };
  for (const [field, value] of Object.entries(writes)) {
    const wear = /^(weapon|possessions\.[12])\.wear\.([123])$/.exec(field);
    if (wear) {
      if (typeof value !== "boolean") fail(`${location}/${pointer(field)}`, "legacy Wear checkbox must be boolean");
    } else {
      // Canonical integer Wear is not a legacy dotted checkbox field.
      if (field.endsWith(".wear")) fail(`${location}/${pointer(field)}`, "ambiguous legacy Wear field; expected checkbox slots");
      try { fieldPath(field); } catch { fail(`${location}/${pointer(field)}`, "unsupported or ambiguous legacy field"); }
    }
    combined[field] = value;
  }
  const handled = new Set();
  const operations = [];
  for (const [field, value] of Object.entries(writes)) {
    const wear = /^(weapon|possessions\.[12])\.wear\.([123])$/.exec(field);
    if (wear) {
      const prefix = `${wear[1]}.wear`;
      if (handled.has(prefix)) continue;
      handled.add(prefix);
      operations.push({ op: "set", path: fieldPath(prefix), value: [1, 2, 3].filter((slot) => combined[`${prefix}.${slot}`] === true).length });
    } else operations.push({ op: "set", path: fieldPath(field), value });
  }
  return { operations, combined };
}

/** Explicit detached migration. No rules inference or catalog relabeling. */
export function migrateState(value) {
  assertJson(value);
  const version = recognizeStateVersion(value);
  if (version === "0.0.2") return structuredClone(assertState(value));
  if (!Array.isArray(value.events)) fail("/events", "legacy events must be an array");
  const snapshot = legacyWrites(value.character, {}, "/character").operations;
  // Empty legacy characters have no event to replay. Snapshot validation below
  // still catches all unsupported envelope and metadata values.
  const character = snapshot.length ? replayEvents([{ id: "migration-snapshot", transaction: "migration", kind: "manual", writes: snapshot }]) : {};
  let previous = {};
  const events = value.events.map((event, index) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) fail(`/events/${index}`, "legacy event must be an object");
    const { operations, combined } = legacyWrites(event.writes, previous, `/events/${index}/writes`);
    previous = combined;
    return { ...event, writes: operations };
  });
  return assertState(structuredClone({ ...value, format: "bork-borg.make-a-fool.state", version: "0.0.2", character, events }));
}

export function importStateJSON(text) {
  return migrateState(parseJSONDocument(text));
}
