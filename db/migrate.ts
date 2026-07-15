/**
 * 套用 db/migrations/ 下未執行過的 migration(記錄在 __drizzle_migrations)。
 * docker 剛起時 postgres 還沒 ready,重試最多 15 秒。
 */
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client";

async function main() {
  const { db, pool } = createDb();
  for (let i = 0; ; i++) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch (e) {
      if (i >= 15) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await migrate(db, { migrationsFolder: path.join(import.meta.dirname, "migrations") });
  console.log("migrations applied");
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
