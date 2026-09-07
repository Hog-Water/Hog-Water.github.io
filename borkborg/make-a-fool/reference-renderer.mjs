import { displayResultKey } from "./reference-catalog.mjs";

function element(name, className = "") {
  const node = document.createElement(name);
  if (className) node.className = className;
  return node;
}

function appendText(parent, name, text, className = "") {
  const node = element(name, className);
  node.textContent = text;
  parent.append(node);
  return node;
}

function chooseControl(reference, onChoose) {
  if (!onChoose) return null;
  const button = element("button", "reference-choose");
  button.type = "button";
  button.textContent = "Choose / Replace";
  button.addEventListener("click", () => onChoose({ reference, trigger: button }));
  return button;
}

function heading(reference) {
  return `${reference.tableLabel} (${reference.die === "d10/d20" ? "d10 block / d20 entry" : reference.die})`;
}

export function renderEntry(reference, { onChoose = null } = {}) {
  if (!reference || reference.resultKey === null) throw new TypeError("renderEntry requires a result-specific reference");
  const article = element("article", "reference-entry");
  article.id = reference.entryAnchor;
  appendText(article, "h3", `${heading(reference)}: ${displayResultKey(reference, reference.resultKey)}`);
  const values = element("dl", "reference-entry-values");
  reference.values.forEach((value, index) => {
    appendText(values, "dt", reference.headings[index + 1] ?? `Value ${index + 1}`);
    appendText(values, "dd", value);
  });
  article.append(values);
  const tableLink = appendText(article, "a", "Open full table", "reference-table-link");
  tableLink.href = reference.tableHref;
  const choose = chooseControl(reference, onChoose);
  if (choose) article.append(choose);
  return article;
}

export function renderTable(reference, { onChoose = null } = {}) {
  if (!reference) throw new TypeError("renderTable requires a table reference");
  const article = element("article", "reference-table");
  article.id = reference.tableAnchor;
  appendText(article, "h2", heading(reference));
  if (reference.die === "d10/d20") appendText(article, "p", "Roll d10 for the 20-entry block, then d20 for the entry.", "reference-instruction");
  const table = element("table");
  const head = element("thead");
  const headerRow = element("tr");
  reference.headings.forEach((label, index) => appendText(headerRow, "th", label, index === 0 ? "reference-die" : ""));
  if (onChoose) { const actionHeading = element("th"); actionHeading.textContent = "Action"; headerRow.prepend(actionHeading); }
  head.append(headerRow);
  const body = element("tbody");
  for (const row of reference.results) {
    const rowReference = Object.freeze({ ...reference, resultKey: row.key, values: Object.freeze([...row.values]), entryAnchor: `result-${reference.tableId}-${row.key}`, entryHref: `/borkborg/tables/#result-${reference.tableId}-${row.key}` });
    const tr = element("tr");
    tr.id = rowReference.entryAnchor;
    const key = element("th", "reference-die");
    key.scope = "row";
    const entryLink = appendText(key, "a", displayResultKey(reference, row.key));
    entryLink.href = rowReference.entryHref;
    tr.append(key);
    row.values.forEach((value) => appendText(tr, "td", value));
    const choose = chooseControl(rowReference, onChoose);
    if (choose) {
      const cell = element("td");
      cell.append(choose);
      tr.prepend(cell);
    }
    body.append(tr);
  }
  table.append(head, body);
  const scroll = element("div", "reference-table-scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("aria-label", `${reference.tableLabel} table, horizontally scrollable`);
  const help = appendText(article, "p", `Scroll the table sideways to read every column.${onChoose ? " Choose / Replace applies only the selected row." : ""}`, "reference-scroll-help");
  help.id = `reference-scroll-${reference.tableId}`;
  scroll.setAttribute("aria-describedby", help.id);
  scroll.append(table); article.append(scroll);
  return article;
}
