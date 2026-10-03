import { defineConfig } from "vitest/config";

// `forks` keeps the native better-sqlite3 module out of worker threads.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], pool: "forks" } });
