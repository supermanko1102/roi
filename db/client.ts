import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export const connectionString =
  process.env.DATABASE_URL ?? "postgres://roi:roi@localhost:5432/taoyuan_roi";

/** ETL/腳本用:自建連線,用完記得 pool.end() */
export function createDb() {
  const pool = new Pool({ connectionString });
  return { db: drizzle(pool, { schema }), pool };
}

export * from "./schema";
