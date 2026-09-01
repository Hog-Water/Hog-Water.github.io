import { catalogSha256 } from "./engine.mjs";
import { createAppModel, populatedWarrantyTargets } from "./app-model.mjs";

const catalogResponse = await fetch("./generated/catalog.json");
if (!catalogResponse.ok) throw new Error("Unable to load the MAKE A FOOL catalog");
const catalogText = await catalogResponse.text();
const catalog = JSON.parse(catalogText);
const model = createAppModel({ catalog, catalogHash: await catalogSha256(catalogText), confirmReplace: (message) => globalThis.confirm(message) });

const sheet = document.querySelector("#sheet");
const candidatePanel = document.querySelector("#candidate-panel");
const choices = document.querySelector("#choices");
const status = document.querySelector("#status");
const serialized = document.querySelector("#serialized");
const possessions = document.querySelector("#possessions");

for (const slot of [1, 2]) {
  possessions.insertAdjacentHTML("beforeend", `<article class="possession" data-possession="${slot}"><div class="section-title"><h3>Possession ${slot}</h3><button data-roll="possession${slot}" type="button">Roll / reroll</button></div><span class="badge" data-warranty="${slot}" hidden>UNDER WARRANTY</span><label>Name<input data-field="possessions.${slot}.name"></label><label>Behavior<textarea data-field="possessions.${slot}.behavior"></textarea></label><fieldset class="wear"><legend>Wear</legend>${[1, 2, 3].map((wear) => `<label><input type="checkbox" data-field="possessions.${slot}.wear.${wear}"> ${wear}</label>`).join("")}</fieldset></article>`);
}

const operationMap = {
  firstName: [() => model.generator.operations.firstName, ["identity.name.firstName"], () => [document.querySelector("#first-name-table").value]],
  lastName: [() => model.generator.operations.lastName, ["identity.name.lastName"]],
  stoutness: [() => model.generator.operations.ability, ["abilities.stoutness", "health.hp.maximum"], () => ["stoutness"]],
  alacrity: [() => model.generator.operations.ability, ["abilities.alacrity"], () => ["alacrity"]],
  savvy: [() => model.generator.operations.ability, ["abilities.savvy"], () => ["savvy"]],
  fortune: [() => model.generator.operations.ability, ["abilities.fortune"], () => ["fortune"]],
  hp: [() => model.generator.operations.hp, ["health.hp.maximum"]],
  background: [() => model.generator.operations.background, ["background.name", "background.know", "background.have", "resources.parts"]],
  wrong: [() => model.generator.operations.wrong, ["identity.wrong"]],
  good: [() => model.generator.operations.good, ["identity.good", "inventory.load.capacity"]],
  debt: [() => model.generator.operations.debt, ["identity.debt"]],
  companion: [() => model.generator.operations.companion, ["identity.companion", "abilities.fortune"]],
  supplies: [() => model.generator.operations.startingSupplies, ["resources.silver", "resources.water", "resources.rations", "resources.parts", "resources.light"]],
  weapon: [() => model.generator.operations.weapon, ["weapon.type", "weapon.family", "weapon.damage", "weapon.ammo_die", "weapon.nickname", "weapon.repair_appearance"]],
  defects: [() => model.generator.operations.defects, ["weapon.defects.1", "weapon.defects.2", "weapon.nickname"]],
  repair: [() => model.generator.operations.repair, ["weapon.repair_history", "weapon.repair_appearance"]],
  possession1: [() => model.generator.operations.possession, ["possessions.1.name", "possessions.1.behavior", "possessions.1.warranty", "possessions.2.warranty", "resources.parts"], () => [1]],
  possession2: [() => model.generator.operations.possession, ["possessions.2.name", "possessions.2.behavior", "possessions.1.warranty", "possessions.2.warranty", "resources.parts"], () => [2]],
  keepsake: [() => model.generator.operations.keepsake, ["keepsake.description"]],
};

function choiceControl(item) {
  const wrapper = document.createElement("div");
  wrapper.className = "choice";
  const label = document.createElement("label");
  label.textContent = item.prompt;
  let readValue;
  if (item.id === "light-choice") {
    label.insertAdjacentHTML("beforeend", '<select><option value="candles">Candles</option><option value="lantern">Basic lantern</option></select>');
    readValue = () => label.querySelector("select").value;
  } else if (item.id === "improvised-nightmare") {
    label.insertAdjacentHTML("beforeend", '<input aria-label="Improvised Nightmare name" required><select aria-label="Improvised Nightmare Family"><option>SIMPLE</option><option>BUILT</option><option>MECHANICAL</option></select>');
    readValue = () => ({ name: label.querySelector("input").value.trim(), family: label.querySelector("select").value });
  } else if (item.id === "warranty-choice") {
    const populated = populatedWarrantyTargets(model.active());
    label.insertAdjacentHTML("beforeend", `<select>${populated.map((slot) => `<option value="${slot}">Possession ${slot}</option>`).join("")}</select>`);
    readValue = () => Number(label.querySelector("select").value);
  } else {
    label.insertAdjacentHTML("beforeend", '<input required>');
    readValue = () => label.querySelector("input").value.trim();
  }
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Apply choice";
  button.addEventListener("click", () => {
    try { model.resolveChoice(item.id, readValue()); render(); }
    catch (error) { status.textContent = error.message; }
  });
  wrapper.append(label, button);
  return wrapper;
}

function render() {
  const active = model.active();
  for (const control of sheet.querySelectorAll("[data-field]")) {
    const value = active.character[control.dataset.field];
    if (control.type === "checkbox") control.checked = value === true;
    else if (document.activeElement !== control) control.value = value ?? "";
    control.disabled = Boolean(model.pending());
  }
  for (const button of sheet.querySelectorAll("button")) button.disabled = Boolean(model.pending());
  for (const slot of [1, 2]) document.querySelector(`[data-warranty="${slot}"]`).hidden = active.character[`possessions.${slot}.warranty`] !== true;
  choices.replaceChildren(...active.unresolved.map(choiceControl));
  candidatePanel.hidden = !model.pending() && active.unresolved.length === 0;
  document.querySelector("#candidate-actions").hidden = !model.pending();
  document.querySelector("#choice-context").textContent = model.pending() ? "Generated candidate" : "Character choice required";
  document.querySelector("#accept-candidate").disabled = active.unresolved.length > 0;
  serialized.value = model.serialize();
  status.textContent = model.pending() ? `${active.unresolved.length} choice${active.unresolved.length === 1 ? "" : "s"} remaining before this Fool can be used.` : "Character sheet ready.";
}

document.querySelector("#make-fool").addEventListener("click", () => { model.generateCandidate(); render(); candidatePanel.scrollIntoView({ behavior: "smooth" }); });
document.querySelector("#accept-candidate").addEventListener("click", () => { try { model.acceptCandidate(); render(); } catch (error) { status.textContent = error.message; } });
document.querySelector("#discard-candidate").addEventListener("click", () => { model.discardCandidate(); render(); });
sheet.addEventListener("change", (event) => {
  const control = event.target.closest("[data-field]");
  if (!control) return;
  const numericFields = new Set(["abilities.stoutness", "abilities.alacrity", "abilities.savvy", "abilities.fortune", "health.hp.current", "health.hp.maximum"]);
  const value = control.type === "checkbox" ? control.checked : numericFields.has(control.dataset.field) && control.value !== "" ? Number(control.value) : control.value;
  model.manualEdit(control.dataset.field, value);
  render();
});
sheet.addEventListener("click", (event) => {
  const button = event.target.closest("[data-roll]");
  if (!button) return;
  const [getOperation, fields, getArgs = () => []] = operationMap[button.dataset.roll];
  try { model.runOperation(getOperation(), fields, ...getArgs()); render(); }
  catch (error) { status.textContent = error.message; }
});

render();
