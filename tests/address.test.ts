import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCnNums, parseSiteAddress, siteAddressCandidates, toHalf } from "../etl/geocode-project-address";

test("parseSiteAddress only classifies exact door, crossroad, or road", () => {
  assert.deepEqual(parseSiteAddress("桃園市", "中壢區", "民權路四段557巷13號旁"), {
    kind: "door", road: "民權路四段557巷", q: "桃園市中壢區民權路四段557巷13號",
  });
  assert.deepEqual(parseSiteAddress("桃園市", "中壢區", "月山路與青山一路交叉口旁"), {
    kind: "cross", road: "月山路", road2: "青山一路",
    q: "桃園市中壢區月山路", q2: "桃園市中壢區青山一路",
  });
  assert.equal(parseSiteAddress("桃園市", "大園區", "科一街上")?.kind, "road");
});

test("normalizeCnNums makes NLSC street names comparable to LVR addresses", () => {
  assert.equal(normalizeCnNums(toHalf("員本里１９鄰新富十一街１５９號")), "員本里19鄰新富11街159號");
  assert.equal(normalizeCnNums("中山路一段928巷"), "中山路1段928巷");
  assert.equal(normalizeCnNums("二十一街"), "21街");
  assert.equal(normalizeCnNums("十全街"), "10全街");
  // 誤轉不影響相等性:兩側都過同一個轉換
  assert.equal(normalizeCnNums("統一路"), "統1路");
  // 非合法數字組合維持原樣
  assert.equal(normalizeCnNums("一九路"), "一九路");
});

test("community streets are ordered after deal address and deduplicated", () => {
  assert.deepEqual(siteAddressCandidates(" 中正路1號 ", ["中正路1號", "民權路2號", "", "民權路2號"]), [
    { raw: "中正路1號", source: "deal" },
    { raw: "民權路2號", source: "community" },
  ]);
  assert.deepEqual(siteAddressCandidates(null, ["民權路2號"]), [
    { raw: "民權路2號", source: "community" },
  ]);
});
