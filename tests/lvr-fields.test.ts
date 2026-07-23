import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { col, num, parseFloor, readCsv, rocDate } from "../etl/lvr-fields";

test("LVR scalar fields parse official formats", () => {
  assert.equal(rocDate("1150701"), "2026-07-01");
  assert.equal(rocDate("1150001"), null);
  assert.equal(num("1,234.5"), 1234.5);
  assert.equal(parseFloor("二十五層"), 25);
  assert.equal(parseFloor("地下二層"), null);
  assert.equal(parseFloor("十一層、十二層"), 11);
  assert.equal(col(["交易年月日", "建物格局房"], "格局", "房"), 1);
});

test("readCsv removes BOM and the English header row", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-lvr-test-"));
  const file = path.join(dir, "sample.csv");
  fs.writeFileSync(file, "\ufeff鄉鎮市區,總價元\nTOWN,PRICE\n中壢區,10000000\n");
  assert.deepEqual(readCsv(file), [["鄉鎮市區", "總價元"], ["中壢區", "10000000"]]);
});
