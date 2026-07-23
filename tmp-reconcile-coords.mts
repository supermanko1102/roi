/**
 * 對帳:每個有座標的建案,其座標必須來自「真實候選地址」(成交代表地址或同名社區街道)
 * 的精確 geocode 快取;對不上的即為 2500 街道掃描 bug 汙染的座標,清空待重定位。
 * 用法:tsx tmp-reconcile-coords.mts [--apply]
 */
import { createDb } from "./db/client";

const apply = process.argv.includes("--apply");
const { pool } = createDb();

const { rows } = await pool.query(`
  WITH cand AS (
    SELECT p.id, p.name, p.city, p.district, p.lat, p.lng,
      (SELECT btrim(mode() WITHIN GROUP (ORDER BY d.address)) FROM presale_deals d
        WHERE d.project_name = p.name AND d.city = p.city AND d.district = p.district
          AND d.address IS NOT NULL) AS addr,
      ARRAY(SELECT DISTINCT btrim(c.street) FROM communities c
        WHERE c.name = p.name AND c.city = p.city AND c.district = p.district
          AND c.street IS NOT NULL AND btrim(c.street) <> '') AS streets
    FROM projects p WHERE p.lat IS NOT NULL AND p.is_demo = false
  ),
  keys AS (
    SELECT id, name, city, district, lat, lng,
      array_remove('proj|' || city || '|' || district || '|' || addr
        || ARRAY(SELECT 'proj|' || city || '|' || district || '|' || s FROM unnest(streets) s), NULL) AS cand_keys
    FROM cand
  )
  SELECT k.id, k.name, k.city, k.district
  FROM keys k
  WHERE NOT EXISTS (
    SELECT 1 FROM geocode_cache g
    WHERE g.addr_key = ANY(k.cand_keys)
      AND g.precision IN ('door','cross','site')
      AND g.lat IS NOT NULL
      AND abs(g.lat - k.lat) < 0.00002 AND abs(g.lng - k.lng) < 0.00002
  )
`);

console.log(`座標對不上真實候選快取的建案:${rows.length} 個`);
for (const r of rows.slice(0, 15)) console.log(`  ${r.id} ${r.city}${r.district} ${r.name}`);
if (rows.length > 15) console.log(`  … 另 ${rows.length - 15} 個`);

if (apply && rows.length) {
  await pool.query(`UPDATE projects SET lat = NULL, lng = NULL WHERE id = ANY($1::int[])`,
    [rows.map((r) => r.id)]);
  console.log(`已清空 ${rows.length} 個建案的座標,待重新定位`);
}
await pool.end();
