import { createLocalRecovery, FOOL_STORAGE_KEY } from "./persistence.mjs";
import { downloadFoolMarkdown, downloadFoolJSON, downloadRawBackup, createJSONImportSession } from "./file-io.mjs";
import { readField } from "./field-adapter.mjs";
import { catalogSha256 } from "./engine.mjs";
import { createAppModel, creationTableDefinitions, directTableArguments, populatedWarrantyTargets } from "./app-model.mjs";

const catalogResponse = await fetch("./generated/catalog.json");
if (!catalogResponse.ok) throw new Error("Unable to load the MAKE A FOOL catalog");
const catalogText = await catalogResponse.text();
const catalog = JSON.parse(catalogText);
let importReplacementApproved = false;
const model = createAppModel({ catalog, catalogHash: await catalogSha256(catalogText), confirmReplace: (message) => importReplacementApproved || globalThis.confirm(message), chooseBackgroundEquipment: () => globalThis.confirm("Replace your Background starting gear with the new Background equipment? OK replaces that gear, including edits or an intentionally empty field. Cancel keeps your current gear while changing the Background. Other Junk & Loot stays unchanged.") ? "replace" : "retain" });
const importSession = createJSONImportSession(model);

const sheet = document.querySelector("#sheet");
const choicePanel = document.querySelector("#choice-panel");
const choices = document.querySelector("#choices");
const status = document.querySelector("#status");
const serialized = document.querySelector("#serialized");
const possessions = document.querySelector("#possessions");
const tables = document.querySelector("#tables");
let fieldEditError = null;
const importFile = document.querySelector("#import-file");
const importDialog = document.querySelector("#import-dialog");
const importStatus = document.querySelector("#import-status");
let importToken = null;
const localRecovery = createLocalRecovery();
const recoveryPanel = document.querySelector("#local-recovery");
const recoveryStatus = document.querySelector("#recovery-status");
const storageStatus = document.querySelector("#storage-status");
const local = localRecovery.inspect();
if (local.status === "supported") model.restore(local.state);
// A fresh blank sheet is not itself a save or an instruction to replace data.
let lastObservedState = model.serialize();
function showStorageStatus(result = localRecovery.status()) {
  storageStatus.textContent = result.message;
  recoveryPanel.hidden = !localRecovery.isProtected();
  if (!recoveryPanel.hidden) recoveryStatus.textContent = result.message;
  document.querySelector("#raw-backup").disabled = localRecovery.rawBackup() === null;
  document.querySelector("#reset-local").disabled = localRecovery.rawBackup() === null;
}
function saveCurrent({ force = false } = {}) {
  const text = model.serialize();
  if (force || text !== lastObservedState) {
    lastObservedState = text;
    showStorageStatus(localRecovery.save(model.current()));
  }
}
showStorageStatus(local);
globalThis.addEventListener("storage", (event) => {
  if (event.key === FOOL_STORAGE_KEY || event.key === null) showStorageStatus(localRecovery.checkExternal());
});
document.querySelector("#raw-backup").addEventListener("click", () => {
  try {
    const { filename } = downloadRawBackup(localRecovery.rawBackup());
    recoveryStatus.textContent = `Raw backup requested: ${filename}. Check your browser's downloads. This is the original stored text, not a validated current-format Fool. Local data is still preserved.`;
  } catch (error) { recoveryStatus.textContent = `Raw backup not started. ${error.message} Local data is still preserved.`; }
});
document.querySelector("#reset-local").addEventListener("click", () => {
  if (!globalThis.confirm("Remove the preserved local payload and start new? Download a raw backup first if you want to keep it. This cannot be undone here.")) return;
  try {
    localRecovery.reset();
    saveCurrent({ force: true });
    showStorageStatus();
    status.textContent = "Preserved local payload removed at your request. The current sheet is now the active Fool. Check the browser saving status above.";
  } catch (error) { recoveryStatus.textContent = `Reset not applied. ${error.message} Reload to review the saved data.`; }
});

for (const slot of [1, 2]) {
  possessions.insertAdjacentHTML("beforeend", `<article class="possession" data-possession="${slot}"><div class="section-title"><h3>Possession ${slot}</h3><button data-roll="possession${slot}" type="button">Roll / reroll</button></div><span class="badge" data-warranty="${slot}" hidden>UNDER WARRANTY</span><label>Name<input data-field="possessions.${slot}.name"></label><label>Behavior<textarea data-field="possessions.${slot}.behavior"></textarea></label><fieldset class="wear"><legend>Wear</legend>${[1, 2, 3].map((wear) => `<label><input type="checkbox" data-field="possessions.${slot}.wear.${wear}"> ${wear}</label>`).join("")}</fieldset></article>`);
}

const operationMap = {
  firstName: [() => model.generator.operations.firstName, ["identity.name.firstName"]],
  lastName: [() => model.generator.operations.lastName, ["identity.name.lastName"]],
  stoutness: [() => model.generator.operations.ability, ["abilities.stoutness", "health.hp.maximum"], () => ["stoutness"]],
  alacrity: [() => model.generator.operations.ability, ["abilities.alacrity"], () => ["alacrity"]],
  savvy: [() => model.generator.operations.ability, ["abilities.savvy"], () => ["savvy"]],
  fortune: [() => model.generator.operations.ability, ["abilities.fortune"], () => ["fortune"]],
  hp: [() => model.generator.operations.hp, ["health.hp.maximum"]],
  background: [() => model.generator.operations.background, ["background.name", "background.know", "resources.parts"]],
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
  if (!["light-choice", "improvised-nightmare", "warranty-choice", "lucky-item", "weapon-nickname"].includes(item.id)) {
    const note = document.createElement("p");
    note.textContent = "Recorded detail from this Fool's saved state. It is preserved in the JSON record; no automatic resolution is available here.";
    wrapper.append(label, note);
    return wrapper;
  }
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

function renderCompanionNameDetail() {
  const identity = model.current().character.identity;
  document.querySelector("#companion-name-outstanding").hidden = !identity?.companion?.trim() || Boolean(identity?.companionName?.trim());
}

function fitSheetText() {
  const fields = [...sheet.querySelectorAll("textarea")];
  for (const field of fields) field.style.minHeight = "";
  for (const field of fields) {
    const border = field.offsetHeight - field.clientHeight;
    field.style.minHeight = `${field.scrollHeight + border}px`;
  }
  for (const selector of ["#field-background textarea", "#field-defects textarea", "#field-repair textarea", ".possession textarea"]) {
    const group = [...sheet.querySelectorAll(selector)];
    const height = Math.max(...group.map((field) => field.offsetHeight));
    for (const field of group) field.style.minHeight = `${height}px`;
  }
}

// Save valid focused edits immediately; reload must not require a blur first.
sheet.addEventListener("input", (event) => {
  const control = event.target.closest("[data-field]");
  if (!control) return;
  try {
    const corrected = fieldEditError !== null;
    commitControl(control, { coalesce: true });
    saveCurrent();
    renderCompanionNameDetail();
    serialized.value = model.serialize();
    if (corrected) status.textContent = "Corrected edit applied. Check browser saving status above.";
  } catch (error) {
    fieldEditError = error;
    status.textContent = `This edit is not valid yet and has not been saved. ${error.message}`;
  }
  if (control.matches("textarea")) fitSheetText();
});
sheet.addEventListener("focusout", (event) => {
  if (event.target.matches("[data-field]")) model.endManualEdit();
});
globalThis.addEventListener("resize", fitSheetText);

function render({ forceSheet = false } = {}) {
  saveCurrent();
  const active = model.current();
  for (const control of sheet.querySelectorAll("[data-field]")) {
    const value = readField(active.character, control.dataset.field);
    if (control.type === "checkbox") control.checked = value === true;
    else if (forceSheet || document.activeElement !== control) control.value = value ?? "";
  }
  for (const slot of [1, 2]) document.querySelector(`[data-warranty="${slot}"]`).hidden = readField(active.character, `possessions.${slot}.warranty`) !== true;
  renderCompanionNameDetail();
  choices.replaceChildren(...active.unresolved.map(choiceControl));
  choicePanel.hidden = active.unresolved.length === 0;
  serialized.value = model.serialize();
  status.textContent = active.unresolved.length
    ? `Character sheet ready. ${active.unresolved.length} outstanding detail${active.unresolved.length === 1 ? "" : "s"} can be finished at any time.`
    : "Character sheet ready.";
  if (!model.catalogMatches()) status.textContent += " Historical catalog: manual edits and backup remain available; catalog rolls require a newly generated Fool.";
  fitSheetText();
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
    const article = document.createElement("details");
    article.className = "creation-table";
    article.id = `table-${definition.id}`;
    const heading = document.createElement("summary");
    heading.textContent = `${definition.label} (${sourceTable.die === "d10/d20" ? "d10 block / d20 entry" : sourceTable.die})`;
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
      key.textContent = definition.id === "first_name" ? `${Math.floor((row.key - 1) / 20) + 1} / ${(row.key - 1) % 20 + 1}` : row.key;
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

// Reference DOM is created once. Character renders leave each disclosure intact.
function navigateToReference(target) {
  let ancestor = target;
  while (ancestor) {
    if (ancestor.matches("details")) ancestor.open = true;
    ancestor = ancestor.parentElement;
  }
  const focusTarget = target.matches("details") ? target.querySelector("summary") : target;
  if (!focusTarget.matches("summary, a, button, input, select, textarea")) focusTarget.tabIndex = -1;
  focusTarget.focus({ preventScroll: true });
  target.scrollIntoView({ block: "start" });
}

document.addEventListener("click", (event) => {
  const link = event.target.closest('a[href^="#"]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const target = document.getElementById(link.hash.slice(1));
  if (!target || !target.closest("#creation-tables")) return;
  event.preventDefault();
  navigateToReference(target);
});

// Print retains the creation references that were visible before screen collapse.
// Restore every individual screen choice when preview or printing finishes.
let referencesBeforePrint = null;
globalThis.addEventListener("beforeprint", () => {
  if (referencesBeforePrint) return;
  referencesBeforePrint = [...document.querySelectorAll("#creation-tables, #tables details")].map((section) => [section, section.open]);
  for (const [section] of referencesBeforePrint) section.open = true;
});
globalThis.addEventListener("afterprint", () => {
  for (const [section, open] of referencesBeforePrint ?? []) section.open = open;
  referencesBeforePrint = null;
});

document.querySelector("#make-fool").addEventListener("click", () => {
  model.generateFool();
  render();
  sheet.scrollIntoView({ behavior: "smooth" });
});
function commitControl(control, { coalesce = false } = {}) {
  const numericFields = new Set(["abilities.stoutness", "abilities.alacrity", "abilities.savvy", "abilities.fortune", "health.hp.current", "health.hp.maximum"]);
  const value = control.type === "checkbox" ? control.checked : numericFields.has(control.dataset.field) && control.value !== "" ? Number(control.value) : control.value;
  const current = readField(model.current().character, control.dataset.field) ?? (control.type === "checkbox" ? false : "");
  const displayed = control.type === "checkbox" ? current === true : String(current);
  const controlValue = control.type === "checkbox" ? control.checked : control.value;
  if (controlValue !== displayed && value !== current) model.manualEdit(control.dataset.field, value, { coalesce });
  if (!coalesce) model.endManualEdit();
  fieldEditError = null;
}

function commitFocusedEdit(action) {
  if (fieldEditError) {
    const error = fieldEditError;
    fieldEditError = null;
    throw new Error(`${error.message} The previous value was kept. Review it and try ${action} again.`);
  }
  const focused = document.activeElement;
  if (focused?.matches("[data-field]") && sheet.contains(focused)) commitControl(focused);
}

function downloadCurrent(format = "JSON") {
  commitFocusedEdit(`Download ${format}`);
  saveCurrent();
  model.endManualEdit();
  const { filename } = (format === "Markdown" ? downloadFoolMarkdown : downloadFoolJSON)(model.current());
  serialized.value = model.serialize();
  return `Download requested: ${filename}. Check your browser's downloads or save prompt.`;
}

document.querySelector("#download-json").addEventListener("click", () => {
  try { status.textContent = downloadCurrent(); }
  catch (error) { status.textContent = `Download not started. ${error.message}`; }
});

document.querySelector("#download-markdown").addEventListener("click", () => {
  try { status.textContent = downloadCurrent("Markdown"); }
  catch (error) { status.textContent = `Download not started. ${error.message}`; }
});

function importError(error) {
  const detail = error.errors
    ? error.errors.slice(0, 3).map(({ path, message }) => `${path || "/"}: ${message}`).join("; ")
    : error.message;
  return `Import not applied. ${detail} Your current Fool is unchanged.`;
}

function clearImportReview() {
  importToken = null;
  importSession.cancel();
  if (importDialog.open) importDialog.close();
}

document.querySelector("#import-json").addEventListener("click", () => {
  try {
    commitFocusedEdit("Import JSON");
    if (typeof importDialog.showModal !== "function") throw new Error("This browser cannot show the import review. Keep this page open and use a current browser.");
    clearImportReview();
    importFile.value = "";
    importFile.click();
  } catch (error) { status.textContent = importError(error); }
});

importFile.addEventListener("cancel", () => {
  clearImportReview();
  status.textContent = "Import canceled. Your current Fool is unchanged.";
});

importFile.addEventListener("change", async () => {
  clearImportReview();
  const file = importFile.files?.[0];
  if (!file) { status.textContent = "Import canceled. Your current Fool is unchanged."; return; }
  status.textContent = "Reading and checking JSON. Your current Fool is unchanged.";
  try {
    commitFocusedEdit("Import JSON");
    const result = await importSession.read(file);
    if (result.status !== "ready") return;
    // Preserve any edits typed while the read was pending. The session's
    // snapshot guard will refuse replacement if committing them changes state.
    const beforeCommit = model.serialize();
    commitFocusedEdit("Import JSON");
    if (model.serialize() !== beforeCommit) throw new Error("Your current Fool changed while the import was pending. Choose the JSON file again to review replacement.");
    importToken = result.token;
    document.querySelector("#import-summary").textContent = `${result.filename.slice(0, 160)} contains ${result.name.slice(0, 160)} (${result.outstandingDetails} outstanding details).`;
    importStatus.textContent = "The file passed validation. Nothing has been replaced.";
    importDialog.showModal();
  } catch (error) {
    clearImportReview();
    status.textContent = importError(error);
  }
});

document.querySelector("#import-cancel").addEventListener("click", () => importDialog.close());
importDialog.addEventListener("close", () => {
  // Ignore a queued close event from an older review if a new one is open.
  if (importDialog.open) return;
  if (importToken !== null) {
    clearImportReview();
    status.textContent = "Import canceled. Your current Fool is unchanged.";
  }
  document.querySelector("#import-json").focus();
});

document.querySelector("#import-backup").addEventListener("click", () => {
  try { importStatus.textContent = downloadCurrent(); }
  catch (error) { importStatus.textContent = `Download not started. ${error.message} Nothing has been replaced.`; }
});

document.querySelector("#import-replace").addEventListener("click", () => {
  let applied = false;
  try {
    commitFocusedEdit("Import JSON");
    importReplacementApproved = true;
    const replaced = importSession.replace(importToken);
    applied = replaced;
    importReplacementApproved = false;
    clearImportReview();
    if (!replaced) { status.textContent = "Import canceled. Your current Fool is unchanged."; return; }
    fieldEditError = null;
    saveCurrent({ force: true });
    // Closing the native dialog can restore focus to an old sheet control.
    // Explicit whole-record replacement must refresh that control as well.
    render({ forceSheet: true });
    status.textContent = `Imported Fool restored. ${status.textContent} Download a new JSON copy after editing.`;
  } catch (error) {
    clearImportReview();
    status.textContent = applied
      ? "The imported Fool was restored, but the sheet display could not update. Download JSON to keep a copy."
      : importError(error);
  } finally { importReplacementApproved = false; }
});

sheet.addEventListener("change", (event) => {
  const control = event.target.closest("[data-field]");
  if (!control) return;
  try { commitControl(control); render(); }
  catch (error) {
    fieldEditError = error;
    const current = readField(model.current().character, control.dataset.field);
    if (control.type === "checkbox") control.checked = current === true;
    else control.value = current ?? "";
    status.textContent = error.message;
  }
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
