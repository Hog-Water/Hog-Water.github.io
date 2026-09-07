function fragmentId(hash) {
  if (!hash?.startsWith("#")) return null;
  try { return decodeURIComponent(hash.slice(1)); }
  catch { return null; }
}

export function revealReferenceHash({ documentRoot, hash, clearFilter = () => {} }) {
  const id = fragmentId(hash);
  if (!id) return false;
  const target = documentRoot.getElementById(id);
  if (!target?.closest(".reference-table")) return false;
  clearFilter();
  const disclosure = target.closest(".reference-table-disclosure");
  if (disclosure) disclosure.open = true;
  target.tabIndex = -1;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "start" });
  return true;
}
