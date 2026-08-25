import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { build, context } from "esbuild";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const output = path.join(root, "dist");
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
await Promise.all(["index.html", "styles.css"].map((name) =>
  fs.copyFile(path.join(root, "app/public", name), path.join(output, name))
));
await Promise.all(["examples", "schemas", "docs"].map((name) =>
  fs.cp(path.join(root, name), path.join(output, name), { recursive: true })
));
await Promise.all(["automation-contract.json", "llms.txt"].map((name) =>
  fs.copyFile(path.join(root, name), path.join(output, name))
));
await fs.rm(path.join(output, "examples/helpdesk.source.json"), { force: true });
const options = {
  entryPoints: {
    app: path.join(root, "app/src/client.mjs"),
    "physics-worker": path.join(root, "app/src/physics-worker.mjs")
  },
  outdir: output,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome120", "firefox121", "safari17"],
  sourcemap: true,
  legalComments: "none"
};
if (process.argv.includes("--watch")) {
  const buildContext = await context(options);
  await buildContext.watch();
} else {
  await build(options);
}
console.log(`Built GravityERD into ${output}`);
