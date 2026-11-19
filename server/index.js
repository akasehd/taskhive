import { fileURLToPath } from "node:url";
import { openDatabase } from "./db.js";
import { createApp } from "./app.js";

const PORT = Number(process.env.PORT ?? 3001);
const production = process.env.NODE_ENV === "production";
const db = openDatabase(process.env.DATABASE_PATH ?? "./data/taskhive.db");
const { http, io } = createApp({
  db,
  secureCookies: production && process.env.INSECURE_COOKIES !== "1",
  clientDir: fileURLToPath(new URL("../dist", import.meta.url)),
});

http.listen(PORT, () => console.log(`TaskHive API on http://localhost:${PORT}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    io.close();
    http.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
