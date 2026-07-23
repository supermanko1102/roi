import { Pool, type PoolConfig } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export const connectionString =
  process.env.DATABASE_URL ?? "postgres://roi:roi@localhost:5432/taoyuan_roi";

const positiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export function poolConfig(): PoolConfig {
  return {
    connectionString,
    max: positiveInt(process.env.PG_POOL_MAX, process.env.NODE_ENV === "production" ? 5 : 10),
    connectionTimeoutMillis: positiveInt(process.env.PG_CONNECT_TIMEOUT_MS, 5_000),
    idleTimeoutMillis: positiveInt(process.env.PG_IDLE_TIMEOUT_MS, 30_000),
  };
}

/** ETL/腳本用:自建連線,用完記得 pool.end() */
export function createDb() {
  const pool = new Pool(poolConfig());
  return { db: drizzle(pool, { schema }), pool };
}

export * from "./schema";
