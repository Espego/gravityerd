import { runPhysicsWorkerTask } from "../src/physics-worker-tasks.mjs";

self.addEventListener("message", (event) => {
  const { id, type, payload } = event.data;
  try {
    self.postMessage({ id, result: runPhysicsWorkerTask(type, payload) });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
