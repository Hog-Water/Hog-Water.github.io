import { catalogSha256 } from "./engine.mjs";
import { createAppModel, creationTableDefinitions, directTableArguments, populatedWarrantyTargets } from "./app-model.mjs";

const catalogResponse = await fetch("./generated/catalog.json");
if (!catalogResponse.ok) throw new Error("Unable to load the MAKE A FOOL catalog");
const catalogText = await catalogResponse.text();
const catalog = JSON.parse(catalogText);
const model = createAppModel({ catalog, catalogHash: await catalogSha256(catalogText), confirmReplace: (message) => globalThis.confirm(message) });

const sheet = document.querySelector("#sheet");
const choicePanel = document.querySelector("#choice-panel");
const choices = document.querySelector("#choices");
const status = document.querySelector("#status");
const serialized = document.querySelector("#serialized");
const possessions = document.querySelector("#possessions");
const tables = document.querySelector("#tables");

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
  possession: [() => model.generator.operations.possession, ["possessions.1.name", "possessions.1.behavior", "possessions.2.name", "possessions.2.behavior", "possessions.1.warranty", "possessions.2.warranty", "resources.parts"]],
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
  const active = model.current();
  for (const control of sheet.querySelectorAll("[data-field]")) {
    const value = active.character[control.dataset.field];
    if (control.type === "checkbox") control.checked = value === true;
    else if (document.activeElement !== control) control.value = value ?? "";
  }
  for (const slot of [1, 2]) document.querySelector(`[data-warranty="${slot}"]`).hidden = active.character[`possessions.${slot}.warranty`] !== true;
  choices.replaceChildren(...active.unresolved.map(choiceControl));
  choicePanel.hidden = active.unresolved.length === 0;
  serialized.value = model.serialize();
  status.textContent = active.unresolved.length
    ? `Character sheet ready. ${active.unresolved.length} outstanding detail${active.unresolved.length === 1 ? "" : "s"} can be finished at any time.`
    : "Character sheet ready.";
}

function operationRequest(definition, key, slot) {
  const name = definition.operation;
  const [getOperation, configuredFields] = operationMap[name];
  const fields = name === "possession"
    ? [`possessions.${slot}.name`, `possessions.${slot}.behavior`, "possessions.1.warranty", "possessions.2.warranty", "resources.parts"]
    : configuredFields;
  return [getOperation(), fields, directTableArguments(definition, key, slot)];
}

function renderCreationTables() {
  for (const definition of creationTableDefinitions) {
    const sourceTable = catalog.tables[definition.id];
    if (!sourceTable) throw new Error(`Catalog is missing ${definition.id}`);
    const article = document.createElement("article");
    article.className = "creation-table";
    article.id = `table-${definition.id}`;
    const heading = document.createElement("h3");
    heading.textContent = `${definition.label} (${sourceTable.die})`;
    const provenance = document.createElement("p");
    provenance.className = "table-source";
    provenance.textContent = `Source: ${sourceTable.source}`;
    const back = document.createElement("a");
    back.className = "table-link";
    back.href = `#${definition.target}`;
    back.textContent = "Back to sheet field";
    const slot = document.createElement("select");
    if (definition.slotRequired) {
      slot.setAttribute("aria-label", "Possession slot to replace");
      slot.innerHTML = '<option value="1">Possession 1</option><option value="2">Possession 2</option>';
    }
    const table = document.createElement("table");
    const body = document.createElement("tbody");
    for (const row of sourceTable.results) {
      const tr = document.createElement("tr");
      tr.id = `result-${definition.id}-${row.key}`;
      const key = document.createElement("th");
      key.scope = "row";
      key.textContent = row.key;
      tr.append(key, ...row.values.map((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        return cell;
      }));
      const action = document.createElement("td");
      const choose = document.createElement("button");
      choose.type = "button";
      choose.textContent = "Choose";
      choose.dataset.selectTable = definition.id;
      choose.dataset.resultKey = row.key;
      choose.dataset.operation = definition.operation;
      if (definition.slotRequired) choose.dataset.slotControl = `${definition.id}-slot`;
      action.append(choose);
      tr.append(action);
      body.append(tr);
    }
    table.append(body);
    if (definition.slotRequired) { slot.id = `${definition.id}-slot`; article.append(heading, provenance, back, slot, table); }
    else article.append(heading, provenance, back, table);
    tables.append(article);
  }
}

renderCreationTables();

document.querySelector("#make-fool").addEventListener("click", () => {
  model.generateFool();
  render();
  sheet.scrollIntoView({ behavior: "smooth" });
});
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
tables.addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-table]");
  if (!button) return;
  const slot = button.dataset.slotControl ? Number(document.querySelector(`#${button.dataset.slotControl}`).value) : undefined;
  const definition = creationTableDefinitions.find(({ id }) => id === button.dataset.selectTable);
  const [operation, fields, args] = operationRequest(definition, Number(button.dataset.resultKey), slot);
  try {
    model.runOperation(operation, fields, ...args);
    render();
    document.querySelector(`#${definition.target}`).scrollIntoView({ behavior: "smooth" });
  } catch (error) { status.textContent = error.message; }
});

render();
