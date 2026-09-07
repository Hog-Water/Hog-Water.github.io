const TABLE_METADATA = Object.freeze({
  first_name: { label: "First names", headings: ["d10/d20", "Name"] },
  last_name: { label: "Last names", headings: ["d100", "Name"] },
  background: { label: "Background", headings: ["d66", "Background", "You know", "You have"] },
  wrong: { label: "What's Wrong With You?", headings: ["d20", "Result"] },
  good: { label: "One Good Thing", headings: ["d12", "One Good Thing"] },
  debt: { label: "Debt", headings: ["d12", "Debt"] },
  companion: { label: "Companion", headings: ["d12", "Companion"] },
  weapon: { label: "Weapon of Regret", headings: ["d20", "Weapon", "Family", "DMG", "Ammo", "Notes"] },
  defect: { label: "Weapon Defects", headings: ["d20", "Defect", "Rule"] },
  repair: { label: "Repair history", headings: ["d66", "Who or what"] },
  repair_appearance: { label: "Repair appearance by Family", headings: ["d66", "Simple", "Built", "Mechanical"] },
  possession: { label: "Questionably Functional Possessions", headings: ["d100", "Possession", "What it does / what's wrong"] },
  keepsake: { label: "Useless Keepsake", headings: ["d8", "Keepsake"] },
});

// This order is the published catalog's source order. Labels and headings are
// presentation metadata only; result text always comes from the catalog.
export const TABLE_IDS = Object.freeze([
  "background", "companion", "debt", "defect", "first_name", "good", "keepsake",
  "last_name", "possession", "repair", "repair_appearance", "weapon", "wrong",
]);

export function anchorForTable(tableId) {
  return `table-${tableId}`;
}

export function anchorForResult(tableId, resultKey) {
  return `result-${tableId}-${resultKey}`;
}

export function getTable(catalog, tableId) {
  const table = catalog?.tables?.[tableId];
  if (!table || !TABLE_METADATA[tableId] || !Array.isArray(table.results)) return null;
  return table;
}

export function getResult(catalog, tableId, resultKey) {
  const table = getTable(catalog, tableId);
  if (!Number.isInteger(resultKey) || !table) return null;
  return table.results.find((result) => result.key === resultKey) ?? null;
}

export function getReference(catalog, { tableId, resultKey = null } = {}) {
  const table = getTable(catalog, tableId);
  if (!table) return null;
  const result = resultKey === null ? null : getResult(catalog, tableId, resultKey);
  if (resultKey !== null && !result) return null;
  const metadata = TABLE_METADATA[tableId];
  const tableAnchor = anchorForTable(tableId);
  const entryAnchor = result ? anchorForResult(tableId, result.key) : null;
  return Object.freeze({
    tableId,
    tableLabel: metadata.label,
    headings: Object.freeze([...metadata.headings]),
    die: table.die,
    source: table.source,
    sourceSha256: table.sourceSha256,
    columns: table.columns,
    results: Object.freeze(table.results.map((row) => Object.freeze({ key: row.key, values: Object.freeze([...row.values]) }))),
    resultKey: result?.key ?? null,
    values: Object.freeze(result ? [...result.values] : []),
    tableAnchor,
    entryAnchor,
    tableHref: `/borkborg/tables/#${tableAnchor}`,
    entryHref: entryAnchor ? `/borkborg/tables/#${entryAnchor}` : null,
  });
}

export function displayResultKey(reference, resultKey) {
  if (reference.tableId !== "first_name") return String(resultKey);
  return `${Math.floor((resultKey - 1) / 20) + 1} / ${(resultKey - 1) % 20 + 1}`;
}
