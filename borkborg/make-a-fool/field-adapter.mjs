/** Existing DOM field names adapt to the schema's typed portable paths. */
import { fieldPaths } from "./generated/state-fields.mjs";
import { StateValidationError } from "./state-contract.mjs";

export function fieldPath(field) {
  if (Object.hasOwn(fieldPaths, field)) return [...fieldPaths[field]];
  throw new StateValidationError([{ path: `/character/${field}`, message: "unsupported or ambiguous field" }]);
}
export function readField(character, field) {
  const wear = /^(weapon|possessions\.[12])\.wear\.([123])$/.exec(field);
  if (wear) return (readField(character, `${wear[1]}.wear`) ?? 0) >= Number(wear[2]);
  return fieldPath(field).reduce((value, key) => value?.[key], character);
}
export function writesField(event, field) {
  const path = fieldPath(field);
  return event.writes.some((operation) => operation.path.length === path.length && operation.path.every((key, index) => key === path[index]));
}
export function fieldWrite(character, field, value) {
  const wear = /^(weapon|possessions\.[12])\.wear\.([123])$/.exec(field);
  if (wear) {
    if (typeof value !== "boolean") throw new StateValidationError([{ path: `/character/${field}`, message: "Wear checkbox must be boolean" }]);
    const target = `${wear[1]}.wear`;
    const count = readField(character, target) ?? 0;
    return { op: "set", path: fieldPath(target), value: count + (value === readField(character, field) ? 0 : value ? 1 : -1) };
  }
  return { op: "set", path: fieldPath(field), value };
}
export function flatWrites(writes) {
  return Object.entries(writes).map(([field, value]) => ({ op: "set", path: fieldPath(field), value }));
}

export function nextIdentity(events, prefix) {
  const used = new Set(events.flatMap((event) => [event.id, event.transaction]));
  let number = 1;
  while (used.has(`${prefix}${number}`)) number++;
  return `${prefix}${number}`;
}
