import { assertState } from "./state-contract.mjs";

const labels = {
  identity: "Identity", name: "Name", firstName: "First name", lastName: "Last name",
  wrong: "What's wrong with you", good: "What you're good at", debt: "Debt", companion: "Companion", companionName: "Companion name",
  abilities: "Abilities", health: "Health", hp: "HP", current: "Current", maximum: "Maximum",
  knowledge: "Skills & Knowledge", learned: "Learned skills & context", startingKnowledge: "Background starting knowledge",
  background: "Background", know: "You know", have: "Starting possessions",
  resources: "Resources", parts: "Useful Parts", light: "Light source",
  inventory: "Inventory", startingGear: "Background starting gear", load: "Load", capacity: "Capacity", other_junk: "Other junk",
  weapon: "Weapon", ammo_die: "Ammo Die", repair_history: "Repair history",
  repair_appearance: "Repair appearance", possessions: "Possessions", keepsake: "Keepsake",
  notes: "Notes", scars_people_angry: "Scars, people, and reasons they're angry",
};
const label = (key) => labels[key] ?? key.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());

/** Escape untrusted prose, including HTML, links, fences, and line-start syntax. */
export function escapeMarkdown(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replace(/[\\`*_{}\[\]()#+.!|~=-]/g, "\\$&");
}

function prose(value) {
  if (value === "") return "(Blank)";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  // Each line stays in the same quote, with explicit breaks for long notes.
  // Nonbreaking indentation avoids Markdown code blocks; tabs display as four spaces.
  return escapeMarkdown(value).replace(/\r\n?/g, "\n").split("\n").map((line) => `> ${line.replace(/^[ \t]+/, (indent) => indent.replaceAll(" ", "&#160;").replaceAll("\t", "&#160;".repeat(4)))}`).join("  \n");
}

function renderValue(value, title, depth = 2) {
  const heading = `${"#".repeat(Math.min(depth, 6))} ${escapeMarkdown(title)}\n\n`;
  if (typeof value !== "object") return heading + prose(value) + "\n\n";
  const entries = Object.entries(value);
  if (!entries.length) return heading + "(No entries recorded)\n\n";
  return heading + entries.map(([key, child]) => renderValue(child,
    Array.isArray(value) ? `${title === "Possessions" ? "Possession" : title === "Defects" ? "Defect" : "Entry"} ${Number(key) + 1}` : label(key), depth + 1)).join("");
}

/** Readable export only. JSON remains the complete portable backup. Never mutates state. */
export function renderFoolMarkdown(state) {
  assertState(state);
  let output = "# MAKE A FOOL character record\n\n";
  output += "Export-only readable sheet. Markdown import is not supported. Keep a JSON backup for full fidelity.\n\n";
  output += "Only recorded fields appear below; (Blank) means an intentionally empty value.\n\n";
  // Relocate the accepted inventory field for reading, without changing its portable path.
  const sheet = structuredClone(state.character);
  if (Object.hasOwn(sheet.background ?? {}, "have")) {
    sheet.inventory = { startingGear: sheet.background.have, ...sheet.inventory };
    delete sheet.background.have;
    if (!Object.keys(sheet.background).length) delete sheet.background;
  }
  if (Object.hasOwn(sheet.background ?? {}, "know")) {
    sheet.knowledge = { startingKnowledge: sheet.background.know, ...sheet.knowledge };
    delete sheet.background.know;
    if (!Object.keys(sheet.background).length) delete sheet.background;
  }
  output += Object.entries(sheet).map(([key, value]) => renderValue(value, label(key))).join("");
  if (!Object.keys(state.character).length) output += "No character fields recorded.\n\n";
  output += "## Unresolved choices\n\n";
  output += state.unresolved.length ? state.unresolved.map((choice, index) => renderValue(choice.prompt, `Choice ${index + 1}`, 3)).join("") : "None recorded.\n\n";
  output += "## Provenance and history summary\n\n";
  output += "Catalog provenance and event counts are summarized here. The complete event ledger, rolls, write operations, unresolved-choice metadata, and other machine metadata are omitted. This sheet is not a lossless portable record.\n\n";
  output += `- Portable data version: ${escapeMarkdown(state.version)}\n`;
  output += `- Catalog format: ${escapeMarkdown(state.catalog.format)}\n`;
  output += `- Catalog SHA-256: ${escapeMarkdown(state.catalog.sha256)}\n`;
  output += `- History events: ${state.events.length}\n`;
  output += `- Unresolved choices: ${state.unresolved.length}\n`;
  return output;
}

export function prepareMarkdownDownload(state) {
  const text = renderFoolMarkdown(state);
  const name = [state.character.identity?.name?.firstName, state.character.identity?.name?.lastName]
    .filter(Boolean).join(" ").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 80).replace(/-$/g, "") || "unnamed";
  return { text, filename: `fool-${name}-${state.version}.md`, mimeType: "text/markdown;charset=utf-8" };
}
