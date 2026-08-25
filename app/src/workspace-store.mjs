const DATABASE_NAME = "gravityerd";
const STORE_NAME = "workspaces";

export function normalizeStoredWorkspaceRecord(value) {
  if (!value) return null;
  if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "savedAt") && value.workspace) {
    return {
      workspace: value.workspace,
      savedAt: typeof value.savedAt === "string" ? value.savedAt : null
    };
  }
  return { workspace: value, savedAt: null };
}

export function createStoredWorkspaceRecord(workspace, savedAt = new Date().toISOString()) {
  return { workspace, savedAt };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function loadStoredWorkspace(fingerprint) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(fingerprint);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(normalizeStoredWorkspaceRecord(request.result));
    });
  } finally {
    database.close();
  }
}

export async function saveStoredWorkspace(fingerprint, workspace) {
  const database = await openDatabase();
  const record = createStoredWorkspaceRecord(workspace);
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(record, fingerprint);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("Workspace save was aborted"));
    });
  } finally {
    database.close();
  }
  return record.savedAt;
}
