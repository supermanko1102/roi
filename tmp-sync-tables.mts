/**
 * 一次性:把本地「重新生成成本高」的兩張表複製到生產(其餘表由 etl:all 在生產重建)
 *   geocode_cache      NLSC 查詢結果快取(避免對 NLSC 重查 20 萬筆)
 *   contract_materials 契約建材表(瀏覽器爬 3,199 案的成果)
 * 用法:PROD_URL=postgresql://… npx tsx tmp-sync-tables.mts
 */
import { Pool } from "pg";

const local = new Pool({ connectionString: "postgres://roi:roi@localhost:5432/taoyuan_roi" });
const prod = new Pool({ connectionString: process.env.PROD_URL, max: 4 });

async function copyTable(table: string, conflictKey: string) {
  const { rows } = await local.query(`SELECT * FROM ${table}`);
  if (!rows.length) { console.log(`${table}: 本地無資料,跳過`); return; }
  const cols = Object.keys(rows[0]);
  const BATCH = 500;
  await prod.query(`DELETE FROM ${table}`);
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const values: unknown[] = [];
    const tuples = chunk.map((r, ri) =>
      `(${cols.map((c, ci) => { values.push(r[c]); return `$${ri * cols.length + ci + 1}`; }).join(",")})`);
    await prod.query(
      `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(",")}) VALUES ${tuples.join(",")}
       ON CONFLICT (${conflictKey}) DO NOTHING`, values);
    if ((i / BATCH) % 40 === 0) console.log(`${table}: ${i + chunk.length}/${rows.length}`);
  }
  const { rows: [c] } = await prod.query(`SELECT count(*) FROM ${table}`);
  console.log(`${table}: 完成,生產共 ${c.count} 筆`);
}

await copyTable("geocode_cache", "addr_key");
await copyTable("contract_materials", "city, district, project_name");
await local.end(); await prod.end();
