import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { connectionString } from "../../db/client";

// dev 熱重載時避免重複建 Pool
const g = globalThis as unknown as { __pgPool?: Pool };
const pool = g.__pgPool ?? new Pool({ connectionString });
if (process.env.NODE_ENV !== "production") g.__pgPool = pool;

export const db = drizzle(pool, { schema });
export * from "../../db/schema";
