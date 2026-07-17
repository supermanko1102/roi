/**
 * 匯入內政部「租金補貼有效租約」行政區租金基準。
 * 官方目前公開的是彙整表；此資料只作大樣本校驗/備援，不混入 1–10 年單筆租約池。
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { createDb, rent_benchmarks } from "../db/client";

const FILE = path.join(import.meta.dirname, "..", "data", "rent-benchmarks-11409.csv");

async function main() {
  const { db, pool } = createDb();
  const rows = parse(fs.readFileSync(FILE, "utf-8"), { columns: true, skip_empty_lines: true })
    .map((r: Record<string, string>) => ({
      period: r.period,
      city: r.city,
      district: r.district,
      rental_type: r.rental_type,
      age_group: r.age_group,
      samples: +r.samples,
      q25: +r.q25,
      median: +r.median,
      q75: +r.q75,
      source_url: r.source_url,
    }));

  for (const row of rows) {
    await db.insert(rent_benchmarks).values(row).onConflictDoUpdate({
      target: [
        rent_benchmarks.period, rent_benchmarks.city, rent_benchmarks.district,
        rent_benchmarks.rental_type, rent_benchmarks.age_group,
      ],
      set: {
        samples: row.samples, q25: row.q25, median: row.median, q75: row.q75,
        source_url: row.source_url, updated_at: new Date(),
      },
    });
  }
  console.log(`[rent-benchmarks] imported ${rows.length} rows from ${path.basename(FILE)}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
