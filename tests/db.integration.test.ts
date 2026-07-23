import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

const url = process.env.TEST_DATABASE_URL;

test("migrations create observability and precomputed tables", { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url });
  const { rows } = await pool.query(`
    SELECT to_regclass('public.etl_runs') AS etl_runs,
           to_regclass('public.district_band_stats') AS district_band_stats,
           to_regclass('public.zone_band_stats') AS zone_band_stats
  `);
  assert.equal(rows[0].etl_runs, "etl_runs");
  assert.equal(rows[0].district_band_stats, "district_band_stats");
  assert.equal(rows[0].zone_band_stats, "zone_band_stats");
  await pool.end();
});

test("PostgreSQL rollback preserves the previous published value", { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query("CREATE TEMP TABLE atomic_publish(value integer)");
    await client.query("INSERT INTO atomic_publish VALUES (1)");
    await client.query("BEGIN");
    await client.query("DELETE FROM atomic_publish");
    await client.query("INSERT INTO atomic_publish VALUES (2)");
    await client.query("ROLLBACK");
    const { rows } = await client.query("SELECT value FROM atomic_publish");
    assert.deepEqual(rows, [{ value: 1 }]);
  } finally {
    client.release();
    await pool.end();
  }
});
