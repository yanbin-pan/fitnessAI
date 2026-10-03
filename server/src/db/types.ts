import type Database from "better-sqlite3";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

/** Something queries can run on: the database itself or a transaction. */
export type Sql = BaseSQLiteDatabase<"sync", Database.RunResult>;
