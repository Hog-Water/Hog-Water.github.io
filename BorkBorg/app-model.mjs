import { createGenerator, emptyState } from "./engine.mjs";

const NONEMPTY = (value) => value !== undefined && value !== null && value !== "" && value !== false;

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

export const populatedWarrantyTargets = (state) => [1, 2].filter((slot) => state.character[`possessions.${slot}.name`]);

export function createAppModel({ catalog, catalogHash, random, confirmReplace = () => true }) {
  const randomSource = random ?? Math.random;
  const engineGenerator = createGenerator({ catalog, catalogHash, random: randomSource });
  const withConvenienceLight = (options = {}) => options.light === undefined
    ? { ...options, light: randomSource() < 0.5 ? "candles" : "lantern" }
    : options;
  const generator = {
    operations: {
      ...engineGenerator.operations,
      startingSupplies: (current, options = {}) => engineGenerator.operations.startingSupplies(current, withConvenienceLight(options)),
    },
    generateFull: (options = {}) => engineGenerator.generateFull({
      ...options,
      starting: withConvenienceLight(options.starting ?? {}),
    }),
  };
  let state = emptyState(catalogHash);
  let manualSequence = 0;

  function generateFool() {
    if (Object.values(state.character).some(NONEMPTY) && !confirmReplace("Replace the current Fool with a newly generated Fool?")) return state;
    state = generator.generateFull();
    return state;
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
    return state;
  }

  function runOperation(operation, affectedFields, ...args) {
    const occupied = affectedFields.filter((field) => NONEMPTY(state.character[field]));
    if (occupied.length && !confirmReplace(`Replace current ${occupied.join(", ")}?`)) return state;
    state = operation(state, ...args);
    return state;
  }

  function manualEdit(field, value) {
    const number = ++manualSequence;
    state = structuredClone(state);
    state.character[field] = value;
    state.events.push({ id: `manual-${number}`, transaction: `manual-tx-${number}`, kind: "manual", writes: { [field]: value } });
    return state;
  }

  return {
    generator,
    active: () => state,
    current: () => state,
    pending: () => null,
    generateFool,
    resolveChoice,
    runOperation,
    manualEdit,
    serialize: () => JSON.stringify(state, null, 2),
  };
}
