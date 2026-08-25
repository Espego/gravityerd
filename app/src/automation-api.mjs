export const MAX_AUTOMATION_DOCUMENT_BYTES = 16 * 1024 * 1024;

const fingerprintPattern = /^[a-f0-9]{64}$/u;
const selectionKeys = ["expectedFingerprint", "configuration", "layout", "pins"];

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export class AutomationRequestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AutomationRequestError";
    this.code = code;
  }
}

export function parseAutomationDocuments(documents) {
  if (!Array.isArray(documents) || documents.length < 1 || documents.length > 2) {
    throw new AutomationRequestError("invalid-request", "proposeImport requires an array of one or two JSON strings");
  }
  return documents.map((contents, index) => {
    const path = `documents[${index}]`;
    if (typeof contents !== "string") throw new AutomationRequestError("invalid-request", `${path} must be a JSON string`);
    if (new TextEncoder().encode(contents).byteLength > MAX_AUTOMATION_DOCUMENT_BYTES) {
      throw new AutomationRequestError("document-too-large", `${path} exceeds the 16 MiB automation limit`);
    }
    let value;
    try {
      value = JSON.parse(contents);
    } catch {
      throw new AutomationRequestError("invalid-json", `${path} is not valid JSON`);
    }
    if (!plainObject(value)) throw new AutomationRequestError("invalid-document", `${path} must contain a JSON object`);
    return value;
  });
}

export function normalizeImportSelection(selection) {
  if (!plainObject(selection) || Object.keys(selection).some((key) => !selectionKeys.includes(key))) {
    throw new AutomationRequestError("invalid-request", "applyImportProposal requires only expectedFingerprint, configuration, layout, and pins");
  }
  if (typeof selection.expectedFingerprint !== "string" || !fingerprintPattern.test(selection.expectedFingerprint)) {
    throw new AutomationRequestError("invalid-request", "expectedFingerprint must be a lowercase SHA-256 fingerprint");
  }
  for (const key of ["configuration", "layout", "pins"]) {
    if (typeof selection[key] !== "boolean") throw new AutomationRequestError("invalid-request", `${key} must be a boolean`);
  }
  return {
    expectedFingerprint: selection.expectedFingerprint,
    configuration: selection.configuration,
    layout: selection.layout,
    pins: selection.pins
  };
}

export async function automationResponse(action, fallbackCode) {
  try {
    return { ok: true, value: structuredClone(await action()) };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error instanceof AutomationRequestError ? error.code : fallbackCode,
        message: error instanceof Error ? error.message : "Automation operation failed"
      }
    };
  }
}
