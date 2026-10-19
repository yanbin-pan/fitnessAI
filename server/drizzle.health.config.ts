import { defineConfig } from "drizzle-kit";

// health.db, the person's health records (2026-10-19 health tab design §1): its own schema and migrations.
export default defineConfig({ dialect: "sqlite", schema: "./src/db/health-schema.ts", out: "./drizzle-health" });
