import { createGenerator, emptyState } from "./engine.mjs";

const NONEMPTY = (value) => value !== undefined && value !== null && value !== "" && value !== false;

export const populatedWarrantyTargets = (state) => [1, 2].filter((slot) => state.character[`possessions.${slot}.name`]);

export function createAppModel({ catalog, catalogHash, random, confirmReplace = () => true }) {
  const generator = createGenerator({ catalog, catalogHash, random });
  let state = emptyState(catalogHash);
  let candidate = null;
  let manualSequence = 0;

  const active = () => candidate ?? state;
  const setActive = (next) => { if (candidate) candidate = next; else state = next; };

  function generateCandidate() {
    candidate = generator.generateFull();
    return candidate;
  }

  function acceptCandidate() {
    if (!candidate) return state;
    if (candidate.unresolved.length) throw new Error("Resolve every required choice before accepting this Fool");
    if (Object.values(state.character).some(NONEMPTY) && !confirmReplace("Replace the current Fool with this generated candidate?")) return state;
    state = candidate;
    candidate = null;
    return state;
  }

  function discardCandidate() { candidate = null; return state; }

  function resolveChoice(id, value) {
    const operations = generator.operations;
    const current = active();
    const next = {
      "light-choice": () => operations.resolveLight(current, value),
      "lucky-item": () => operations.resolveLuckyItem(current, value),
      "improvised-nightmare": () => operations.resolveImprovisedNightmare(current, value),
      "weapon-nickname": () => operations.resolveWeaponNickname(current, value),
      "warranty-choice": () => operations.warranty(current, value),
    }[id];
    if (!next) throw new Error(`Unsupported choice: ${id}`);
    setActive(next());
    return active();
  }

  function runOperation(operation, affectedFields, ...args) {
    if (candidate) throw new Error("Finish or discard the generated candidate before rerolling the current Fool");
    const occupied = affectedFields.filter((field) => NONEMPTY(state.character[field]));
    if (occupied.length && !confirmReplace(`Replace current ${occupied.join(", ")}?`)) return state;
    state = operation(state, ...args);
    return state;
  }

  function manualEdit(field, value) {
    if (candidate) throw new Error("Accept the candidate before editing play state");
    const number = ++manualSequence;
    state = structuredClone(state);
    state.character[field] = value;
    state.events.push({
      id: `manual-${number}`,
      transaction: `manual-tx-${number}`,
      kind: "manual",
      writes: { [field]: value },
    });
    return state;
  }

  return {
    generator,
    active,
    current: () => state,
    pending: () => candidate,
    generateCandidate,
    acceptCandidate,
    discardCandidate,
    resolveChoice,
    runOperation,
    manualEdit,
    serialize: () => JSON.stringify(state, null, 2),
  };
}
