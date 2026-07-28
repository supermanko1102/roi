import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCnNums, parseSiteAddress, siteAddressCandidates, toHalf } from "../etl/geocode-project-address";
import { parseLandLot } from "../etl/geocode-landlots";

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

test("parseLandLot extracts section and first 8-digit parcel number", () => {
  assert.deepEqual(parseLandLot("三民段28地號等"), { sect: "三民段", no8: "00280000" });
  assert.deepEqual(parseLandLot("斯馨段50、56地號"), { sect: "斯馨段", no8: "00500000" });
  assert.deepEqual(parseLandLot("中路二段29-1地號"), { sect: "中路二段", no8: "00290001" });
  assert.deepEqual(parseLandLot("桃園段武陵小段123地號"), { sect: "桃園段武陵小段", no8: "01230000" });
  assert.equal(parseLandLot("國際路二段"), null);
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

test("permitQueryTail extracts fuzzy query key after 字第", async () => {
  const { permitQueryTail } = await import("../etl/match-permit-doors");
  assert.equal(permitQueryTail("109桃市都建執照字第會龍01641號"), "會龍01641");
  assert.equal(permitQueryTail("(109)桃市都建執照字第會龍01641號"), "會龍01641");
  assert.equal(permitQueryTail("105桃市都建執照字第會龍01168-2"), "會龍01168");
  assert.equal(permitQueryTail("１０９桃市都建執字第會楊００５０８-２"), "會楊00508");
  assert.equal(permitQueryTail("亂七八糟"), null);
});

test("permitMatchKey normalizes year, zeros, parens and revision suffix", async () => {
  const { permitMatchKey, cnRocDate } = await import("../etl/match-permit-doors");
  assert.equal(permitMatchKey("(109)桃市都建執照字第會龍01641號"),
    permitMatchKey("109桃市都建執照字第會龍01641-2"));
  assert.equal(permitMatchKey("109桃市都建執照字第會龍01641號"), "109|會龍1641");
  assert.notEqual(permitMatchKey("108桃市都建執照字第會龍01641號"),
    permitMatchKey("109桃市都建執照字第會龍01641號"));
  assert.equal(cnRocDate("113年04月10日"), "2024-04-10");
  assert.equal(cnRocDate("113年13月10日"), null);
  assert.equal(cnRocDate("年月日"), null);
});

test("parsePermit handles mangled permit formats and permitsMatch guards collisions", async () => {
  const { parsePermit, permitQueryTail, permitsMatch } = await import("../etl/match-permit-doors");
  assert.deepEqual(parsePermit("108桃市都建執照01465-1號"),
    { year: 108, prefix: "", serial: "1465", serialRaw: "01465" });
  assert.deepEqual(parsePermit("桃市都建執照字會觀01532-01號"),
    { year: null, prefix: "會觀", serial: "1532", serialRaw: "01532" });
  assert.equal(permitQueryTail("108桃市都建執照01465-1號"), "01465");
  const a = parsePermit("(109)桃市都建執照字第會龍01641號");
  assert.equal(permitsMatch(a, parsePermit("109桃市都建執字第會龍01641-2")), "exact");
  assert.equal(permitsMatch(a, parsePermit("108桃市都建執照字第會龍01641號")), null);
  assert.equal(permitsMatch(a, parsePermit("109桃市都建執照字第會楊01641號")), null);
  assert.equal(permitsMatch(parsePermit("108桃市都建執照01465號"),
    parsePermit("(108)桃市都建執照字第會桃01465號")), "lenient");
});

test("cnRocDate rejects rolled-over calendar dates", async () => {
  const { cnRocDate } = await import("../etl/match-permit-doors");
  assert.equal(cnRocDate("92年02月29日"), null);
  assert.equal(cnRocDate("113年02月29日"), "2024-02-29");
});
