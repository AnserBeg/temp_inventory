import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const wranglerCli = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);

const result = spawnSync(
  process.execPath,
  [
    wranglerCli,
    "d1",
    "migrations",
    "apply",
    "site-creator-d1",
    "--local",
    "--config",
    "wrangler.local.jsonc",
    "--persist-to",
    ".wrangler/state",
  ],
  {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdio: "inherit",
    env: {
      ...process.env,
      CI: "true",
      WRANGLER_WRITE_LOGS: "false",
      WRANGLER_LOG_PATH: ".wrangler/logs",
      MINIFLARE_REGISTRY_PATH: ".wrangler/registry",
    },
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
