import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const serverRoot = resolve(projectRoot, "dist", "server");
const wranglerCli = resolve(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const stateDirectory = resolve(projectRoot, ".wrangler", "state");
const logDirectory = resolve(projectRoot, ".wrangler", "logs");
const registryPath = resolve(projectRoot, ".wrangler", "registry");

await Promise.all([mkdir(stateDirectory, { recursive: true }), mkdir(logDirectory, { recursive: true }), mkdir(dirname(registryPath), { recursive: true })]);

const child = spawn(process.execPath, [
  wranglerCli,
  "dev",
  "--config",
  "wrangler.json",
  "--persist-to",
  stateDirectory,
  "--port",
  "3000",
], {
  cwd: serverRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    CI: "true",
    WRANGLER_WRITE_LOGS: "false",
    WRANGLER_LOG_PATH: logDirectory,
    MINIFLARE_REGISTRY_PATH: registryPath,
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  throw error;
});

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
