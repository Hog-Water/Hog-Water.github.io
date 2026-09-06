import { createGenerator, emptyState, GenerationError } from "./engine.mjs";
import { assertState, applyEvent, serializeStateJSON } from "./state-contract.mjs";
import { fieldWrite, nextIdentity, readField } from "./field-adapter.mjs";
import { importStateJSON, migrateState } from "./state-migration.mjs";

const NONEMPTY = (value) => value !== undefined && value !== null && value !== "" && value !== false;
const hasContent = (value) => value && typeof value === "object" ? Object.values(value).some(hasContent) : NONEMPTY(value);
const hasStateContent = (state) => hasContent(state.character) || state.events.length > 0 || state.unresolved.length > 0;

export const creationTableDefinitions = Object.freeze([
  { id: "first_name_men", label: "Men's first names", target: "field-first-name", operation: "firstName", args: ["first_name_men"] },
  { id: "first_name_women", label: "Women's first names", target: "field-first-name", operation: "firstName", args: ["first_name_women"] },
  { id: "last_name", label: "Last names", target: "field-last-name", operation: "lastName" },
  { id: "background", label: "Background", target: "field-background", operation: "background" },
  { id: "wrong", label: "What's Wrong With You?", target: "field-wrong", operation: "wrong" },
  { id: "good", label: "One Good Thing", target: "field-good", operation: "good" },
  { id: "debt", label: "Debt", target: "field-debt", operation: "debt" },
  { id: "companion", label: "Companion", target: "field-companion", operation: "companion" },
  { id: "weapon", label: "Weapon of Regret", target: "field-weapon", operation: "weapon" },
  { id: "defect", label: "Weapon Defects", target: "field-defects", operation: "defects" },
  { id: "repair", label: "Repair history", target: "field-repair", operation: "repair" },
  { id: "repair_appearance", label: "Repair appearance by Family", target: "field-repair", operation: "repair" },
  { id: "possession", label: "Questionably Functional Possessions", target: "field-possessions", operation: "possession", slotRequired: true },
  { id: "keepsake", label: "Useless Keepsake", target: "field-keepsake", operation: "keepsake" },
]);

export function directTableArguments(definition, key, slot) {
  const args = definition.args ? [...definition.args] : [];
  if (definition.slotRequired) args.push(slot);
  args.push({ key });
  return args;
}

export const populatedWarrantyTargets = (state) => [1, 2].filter((slot) => readField(state.character, `possessions.${slot}.name`));

export function createAppModel({ catalog, catalogHash, random, confirmReplace = () => true }) {
  const randomSource = random ?? Math.random;
  const engineGenerator = createGenerator({ catalog, catalogHash, random: randomSource });
  const withConvenienceLight = (options = {}) => options.light === undefined
    ? { ...options, light: randomSource() < 0.5 ? "candles" : "lantern" }
    : options;
  const generator = {
    operations: {
      ...engineGenerator.operations,
      startingSupplies: (current, options = {}) => {
        assertState(current);
        if (current.catalog.sha256 !== catalogHash || current.catalog.format !== catalog.format) {
          throw new GenerationError("State and catalog do not match. This historical Fool can be edited and backed up, but catalog rolls require a newly generated Fool.");
        }
        return engineGenerator.operations.startingSupplies(current, withConvenienceLight(options));
      },
    },
    generateFull: (options = {}) => engineGenerator.generateFull({
      ...options,
      starting: withConvenienceLight(options.starting ?? {}),
    }),
  };
  let state = emptyState(catalogHash);

  function generateFool() {
    if (hasStateContent(state) && !confirmReplace("Replace the current Fool with a newly generated Fool?")) return structuredClone(state);
    state = generator.generateFull();
    return structuredClone(state);
  }

  function resolveChoice(id, value) {
    const next = {
      "light-choice": () => generator.operations.resolveLight(state, value),
      "lucky-item": () => generator.operations.resolveLuckyItem(state, value),
      "improvised-nightmare": () => generator.operations.resolveImprovisedNightmare(state, value),
      "weapon-nickname": () => generator.operations.resolveWeaponNickname(state, value),
      "warranty-choice": () => generator.operations.warranty(state, value),
    }[id];
    if (!next) throw new Error(`Unsupported choice: ${id}`);
    state = next();
    return structuredClone(state);
  }

  function runOperation(operation, affectedFields, ...args) {
    const occupied = affectedFields.filter((field) => NONEMPTY(readField(state.character, field)));
    if (occupied.length && !confirmReplace(`Replace current ${occupied.join(", ")}?`)) return structuredClone(state);
    state = assertState(operation(structuredClone(state), ...args));
    return structuredClone(state);
  }

  function manualEdit(field, value) {
    const writes = [fieldWrite(state.character, field, value)];
    // On a newly blank sheet the first Defect control is visibly blank. Record
    // its initialization explicitly, never as an unrecorded sparse placeholder.
    if (field === "weapon.defects.2" && readField(state.character, "weapon.defects.1") === undefined) {
      writes.unshift(fieldWrite(state.character, "weapon.defects.1", ""));
    }
    const event = { id: nextIdentity(state.events, "manual-"), transaction: nextIdentity(state.events, "manual-tx-"), kind: "manual", writes };
    const candidate = { ...structuredClone(state), character: applyEvent(state.character, event), events: [...structuredClone(state.events), event] };
    state = assertState(candidate);
    return structuredClone(state);
  }

  function prepareRestore(input) {
    return typeof input === "string" ? importStateJSON(input) : migrateState(input);
  }
  function restore(candidate) {
    // Validate and detach before asking to replace; an invalid candidate must
    // not prompt, and cancel must preserve the current snapshot and history.
    const next = structuredClone(assertState(candidate));
    if (hasStateContent(state) && !confirmReplace("Replace the current Fool with the imported Fool?")) return false;
    state = next;
    return true;
  }

  return {
    generator,
    active: () => structuredClone(state),
    current: () => structuredClone(state),
    pending: () => null,
    generateFool,
    resolveChoice,
    runOperation,
    manualEdit,
    prepareRestore,
    restore,
    catalogMatches: () => state.catalog.sha256 === catalogHash && state.catalog.format === catalog.format,
    serialize: () => serializeStateJSON(state),
  };
}
