import { assertJson, assertState, LEGACY_FORMAT, PORTABLE_FORMAT, parseJSONDocument, StateValidationError } from "./state-contract.mjs";

// Release support is explicit. Numeric ordering never establishes compatibility.
export const SUPPORTED_PORTABLE_VERSIONS = Object.freeze(["0.0.3"]);

export function assertSupportedState(value) {
  assertJson(value);
  const detected = value?.format === LEGACY_FORMAT && !Object.hasOwn(value, "version")
    ? "0.0.1" : String(value?.version ?? "missing");
  if (value?.format !== PORTABLE_FORMAT || !SUPPORTED_PORTABLE_VERSIONS.includes(value?.version)) {
    throw new StateValidationError([{ path: "/version", message: `Unsupported portable data: detected ${detected} (format ${String(value?.format ?? "missing")}). Supported versions: ${SUPPORTED_PORTABLE_VERSIONS.join(", ")}. Keep the original file; this release does not convert it.` }]);
  }
  return assertState(value);
}

export function prepareSupportedState(input) {
  return structuredClone(assertSupportedState(typeof input === "string" ? parseJSONDocument(input) : input));
}
