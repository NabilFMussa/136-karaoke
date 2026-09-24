import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp, defaultWebRoot } from "./app.ts";

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const host = process.env.HOST ?? "0.0.0.0";
const defaultDatabasePath = fileURLToPath(new URL("../../../data/karaoke.sqlite", import.meta.url));
const databasePath = process.env.DATABASE_PATH ?? defaultDatabasePath;
const candidateWebRoot = process.env.WEB_ROOT ?? defaultWebRoot();
const webRoot = existsSync(candidateWebRoot) ? candidateWebRoot : undefined;

const app = createApp({ databasePath, ...(webRoot ? { webRoot } : {}) });

app.server.listen(port, host, () => {
  console.log(`Karaoke Server API listening at http://${host}:${port}`);
  console.log(`SQLite database: ${databasePath}`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received; shutting down`);
  app.server.close(() => {
    app.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
