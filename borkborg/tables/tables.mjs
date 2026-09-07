import { TABLE_IDS, getReference } from "../make-a-fool/reference-catalog.mjs";
import { renderTable } from "../make-a-fool/reference-renderer.mjs";
import { revealReferenceHash } from "./hash-navigation.mjs";

const tableRoot = document.querySelector("#tables");
const indexRoot = document.querySelector("#table-index");
const search = document.querySelector("#table-search");
const clear = document.querySelector("#clear-search");
const status = document.querySelector("#search-status");
const noResults = document.querySelector("#no-results");
const returnNote = document.querySelector("#sheet-return");

function tableText(reference) {
  return [reference.tableLabel, reference.die, reference.source, ...reference.results.flatMap((row) => [row.key, ...row.values])].join(" ").toLocaleLowerCase();
}

function applySearch() {
  const query = search.value.trim().toLocaleLowerCase();
  let visible = 0;
  let rows = 0;
  for (const disclosure of tableRoot.children) {
    const article = disclosure.querySelector(".reference-table");
    const matches = !query || disclosure.dataset.search.includes(query);
    disclosure.hidden = !matches;
    disclosure.open = Boolean(query) && matches;
    if (matches) visible += 1;
    const wholeTable = !query || disclosure.dataset.metadata.includes(query);
    for (const row of article.querySelectorAll("tbody tr")) {
      row.hidden = !wholeTable && !row.textContent.toLocaleLowerCase().includes(query);
      if (matches && !row.hidden) rows += 1;
    }
  }
  for (const link of indexRoot.querySelectorAll("a")) {
    const target = document.getElementById(link.hash.slice(1));
    link.closest("li").hidden = Boolean(query) && Boolean(target?.closest(".reference-table-disclosure")?.hidden);
  }
  clear.disabled = !query;
  noResults.hidden = visible !== 0;
  status.textContent = query ? `${rows} result${rows === 1 ? "" : "s"} in ${visible} table${visible === 1 ? "" : "s"} match "${search.value.trim()}".` : "All creation tables are shown.";
}

function tableIndex(reference) {
  const item = document.createElement("li");
  const link = document.createElement("a");
  link.href = `#${reference.tableAnchor}`;
  link.textContent = `${reference.tableLabel} (${reference.die === "d10/d20" ? "d10 block / d20 entry" : reference.die})`;
  item.append(link);
  indexRoot.append(item);
}

function tableDisclosure(reference, table) {
  const disclosure = document.createElement("details");
  disclosure.className = "reference-table-disclosure";
  const summary = document.createElement("summary");
  summary.textContent = `${reference.tableLabel} (${reference.die === "d10/d20" ? "d10 block / d20 entry" : reference.die})`;
  disclosure.append(summary, table);
  return disclosure;
}

function revealCurrentHash() {
  return revealReferenceHash({
    documentRoot: document,
    hash: window.location.hash,
    clearFilter: () => {
      if (!search.value) return;
      search.value = "";
      applySearch();
    },
  });
}

async function load() {
  const response = await fetch("../make-a-fool/generated/catalog.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("The source-derived catalog could not be loaded.");
  const catalog = await response.json();
  for (const tableId of TABLE_IDS) {
    const reference = getReference(catalog, { tableId });
    if (!reference) throw new Error(`Catalog is missing public table ${tableId}.`);
    const table = renderTable(reference);
    const disclosure = tableDisclosure(reference, table);
    disclosure.dataset.search = tableText(reference);
    disclosure.dataset.metadata = [reference.tableLabel, reference.die, reference.source].join(" ").toLocaleLowerCase();
    tableRoot.append(disclosure);
    tableIndex(reference);
  }
  applySearch();
  revealCurrentHash();
}

search.addEventListener("input", applySearch);
clear.addEventListener("click", () => { search.value = ""; applySearch(); search.focus(); });
indexRoot.addEventListener("click", (event) => {
  if (!event.target.closest('a[href^="#"]')) return;
  requestAnimationFrame(revealCurrentHash);
});
window.addEventListener("hashchange", revealCurrentHash);
if (window.opener) {
  returnNote.replaceChildren("This page was opened from a sheet. Close this tab or switch back to the existing sheet tab when you are finished.");
}
load().catch((error) => { status.textContent = error.message; status.setAttribute("role", "alert"); });
