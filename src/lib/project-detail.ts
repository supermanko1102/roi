import { and, asc, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { db, building_community, communities, presale_deals, projects, rent_deals, sale_deals, contract_materials, contract_material_facts } from "@/lib/db";
import { ageBand } from "@/lib/age";
import { getProjectMetrics, projectKey } from "@/lib/project-metrics";

// 建案詳情:彙總 + 備查資訊(戶數/建照/完工)+ 全部成交明細(含解約件,前端自行拆分計算)。
// /api/project-detail(抽屜)與 /project/...(獨立頁,伺服器端直出)共用同一份資料。
// key 用 (city, district, name):projects 的自然鍵,與 room_stats/points 一致。
export async function loadProjectDetail(city: string, district: string, name: string) {
  const [p] = await db.select().from(projects)
    .where(and(eq(projects.name, name), eq(projects.city, city), eq(projects.district, district)));
  if (!p) return null;

  // 備查建案可能同名多筆(分期),優先取有完工日(使照 > 首次登記)的那筆
  const comms = await db.select().from(communities)
    .where(and(eq(communities.name, name), eq(communities.city, city), eq(communities.district, district)));
  const comm = comms.find((c) => (c.use_issue_date ?? c.first_reg) != null) ?? comms[0] ?? null;

  const deals = await db.select({
    deal_date: presale_deals.deal_date, total_price: presale_deals.total_price,
    area_ping: presale_deals.area_ping, unit_price: presale_deals.unit_price,
    parking_count: presale_deals.parking_count, parking_type: presale_deals.parking_type,
    parking_price: presale_deals.parking_price, parking_area_ping: presale_deals.parking_area_ping,
    rooms: presale_deals.rooms, baths: presale_deals.baths,
    floor_no: presale_deals.floor_no, total_floors: presale_deals.total_floors,
    unit_id: presale_deals.unit_id,
    is_cancelled: presale_deals.is_cancelled, cancel_date: presale_deals.cancel_date,
  }).from(presale_deals)
    .where(and(eq(presale_deals.project_name, name), eq(presale_deals.city, city), eq(presale_deals.district, district)))
    .orderBy(asc(presale_deals.deal_date)).limit(1500);

  // 契約建材設備表(只在成功抽到時才回傳)
  const [mat] = await db.select({
    sections: contract_materials.sections, pdf_url: contract_materials.pdf_url,
  }).from(contract_materials)
    .where(and(
      eq(contract_materials.project_name, name),
      eq(contract_materials.city, city),
      eq(contract_materials.district, district),
      eq(contract_materials.status, "ok"),
    ));
  // 建材分類摘要(etl/classify-materials.ts 產出;無資料時不回傳)
  const [factRow] = await db.select({
    kitchen_brands: contract_material_facts.kitchen_brands,
    bath_brands: contract_material_facts.bath_brands,
    floor_materials: contract_material_facts.floor_materials,
    kitchen_tier: contract_material_facts.kitchen_tier,
    bath_tier: contract_material_facts.bath_tier,
    floor_tier: contract_material_facts.floor_tier,
  }).from(contract_material_facts)
    .where(and(
      eq(contract_material_facts.project_name, name),
      eq(contract_material_facts.city, city),
      eq(contract_material_facts.district, district),
    ));
  const facts = factRow
    ? {
        kitchen_brands: JSON.parse(factRow.kitchen_brands ?? "[]") as string[],
        bath_brands: JSON.parse(factRow.bath_brands ?? "[]") as string[],
        floor_materials: JSON.parse(factRow.floor_materials ?? "[]") as string[],
        kitchen_tier: factRow.kitchen_tier, bath_tier: factRow.bath_tier, floor_tier: factRow.floor_tier,
      }
    : null;
  const materials = mat
    ? { sections: JSON.parse(mat.sections ?? "[]") as { title: string; body: string }[], pdf_url: mat.pdf_url, facts }
    : null;

  const regDate = comm?.use_issue_date ?? comm?.first_reg;
  const regYear = regDate ? new Date(regDate).getFullYear() : null;
  const nowYear = new Date().getFullYear();
  const completed = regYear != null && regYear <= nowYear;
  const knownHouseholds = comms
    .map((item) => item.households)
    .filter((value): value is number => value != null);
  const totalHouseholds = knownHouseholds.length
    ? knownHouseholds.reduce((sum, value) => sum + value, 0)
    : null;

  // 交屋後轉售:地號歸戶(building_community)把 a 檔門牌接回本案。
  // 只取交屋(使照/首次登記)之後的成交——預售期交易可能同時揭露在 a/b 檔,以日期切開避免重複。
  // 門牌只留街道段(去掉城市+行政區前綴),給前端顯示與歸位用
  const stripAddr = (key: string | null) => key ? key.replace(city, "").replace(district, "") : null;
  // 店面判定:整棟型態建案的店面戶 building_type 仍是「住宅大樓」,以 1樓+0房 補判
  const isStore = (r: { building_type: string | null; floor_no: number | null; rooms: number | null }) =>
    (r.building_type?.includes("店面") ?? false) || (r.floor_no === 1 && r.rooms === 0);

  let resales: {
    deal_date: string | null; floor_no: number | null; rooms: number | null; baths: number | null;
    total_price: number | null; unit_price: number | null; area_ping: number | null;
    parking_count: number | null; parking_type: string | null;
    parking_price: number | null; parking_area_ping: number | null;
    addr: string | null; is_store: boolean;
  }[] = [];
  // 預售棟戶代號 ↔ 門牌:交屋辦移轉時同筆交易會在 a 檔以門牌再揭露(日期/樓層/總價相同),
  // 兩檔 self-join 即得對照錨點;前端按門牌多數決把轉售歸回棟別圖欄位。
  let unitDoors: { unit_id: string | null; addr: string | null; n: number }[] = [];
  const caseNos = comms.map((c) => c.case_no);
  if (completed && regDate && caseNos.length) {
    const rows = await db.select({
      deal_date: sale_deals.deal_date, floor_no: sale_deals.floor_no,
      rooms: sale_deals.rooms, baths: sale_deals.baths,
      total_price: sale_deals.total_price, unit_price: sale_deals.unit_price,
      area_ping: sale_deals.area_ping,
      parking_count: sale_deals.parking_count, parking_type: sale_deals.parking_type,
      parking_price: sale_deals.parking_price, parking_area_ping: sale_deals.parking_area_ping,
      addr_key: sale_deals.addr_key, building_type: sale_deals.building_type,
    }).from(sale_deals)
      .innerJoin(building_community, eq(building_community.addr_key, sale_deals.addr_key))
      .where(and(inArray(building_community.case_no, caseNos), gt(sale_deals.deal_date, regDate)))
      .orderBy(desc(sale_deals.deal_date)).limit(200);
    resales = rows.map(({ addr_key, building_type, ...r }) => ({
      ...r, addr: stripAddr(addr_key), is_store: isStore({ building_type, floor_no: r.floor_no, rooms: r.rooms }),
    }));

    const doorRows = await db.select({
      unit_id: presale_deals.unit_id,
      addr_key: sale_deals.addr_key,
      n: sql<number>`count(*)::int`,
    }).from(sale_deals)
      .innerJoin(building_community, eq(building_community.addr_key, sale_deals.addr_key))
      .innerJoin(presale_deals, and(
        eq(presale_deals.deal_date, sale_deals.deal_date),
        eq(presale_deals.floor_no, sale_deals.floor_no),
        sql`abs("presale_deals"."total_price" - "sale_deals"."total_price") < 1`,
      ))
      .where(and(
        inArray(building_community.case_no, caseNos),
        eq(presale_deals.project_name, name), eq(presale_deals.city, city), eq(presale_deals.district, district),
        sql`"presale_deals"."is_cancelled" IS NOT TRUE`,
        isNotNull(presale_deals.unit_id),
      ))
      .groupBy(presale_deals.unit_id, sale_deals.addr_key);

    // 老案(實登 2.0 前)預售地址本身就帶門牌(「吉安街185號4樓A1-4F」),
    // 地址內含歸戶門牌者直接成為對照錨點,不必等 a 檔重複揭露
    const addrRows = await db.select({
      unit_id: presale_deals.unit_id,
      addr_key: building_community.addr_key,
      n: sql<number>`count(*)::int`,
    }).from(presale_deals)
      .innerJoin(building_community, and(
        inArray(building_community.case_no, caseNos),
        sql`translate("presale_deals"."address", '0123456789', '０１２３４５６７８９')
          LIKE '%' || replace("building_community"."addr_key", ${city + district}, '') || '%'`,
      ))
      .where(and(
        eq(presale_deals.project_name, name), eq(presale_deals.city, city), eq(presale_deals.district, district),
        isNotNull(presale_deals.unit_id),
      ))
      .groupBy(presale_deals.unit_id, building_community.addr_key);

    const merged = new Map<string, { unit_id: string | null; addr: string | null; n: number }>();
    for (const u of [...doorRows, ...addrRows]) {
      const key = `${u.unit_id}|${u.addr_key}`;
      const e = merged.get(key) ?? { unit_id: u.unit_id, addr: stripAddr(u.addr_key), n: 0 };
      e.n += u.n;
      merged.set(key, e);
    }
    unitDoors = [...merged.values()];
  }

  // 本社區出租行情與租約明細:與轉售同一條歸戶管線(communities → building_community → rent_deals)。
  // 欄位對齊 drawer-kit 的 RLease,前端直接餵 LeaseTable;中位數也由前端以市場件計算。
  let rents: {
    deal_date: string | null; addr: string | null;
    floor_no: number | null; total_floors: number | null;
    area_ping: number | null; rooms: number | null; halls: number | null;
    rental_type: string | null; building_type: string | null; build_year: number | null;
    monthly_rent: number | null; housing_rent: number | null;
    parking_rent: number | null; rent_per_ping: number | null;
    is_social: boolean | null;
  }[] = [];
  if (caseNos.length) {
    const rentRows = await db.selectDistinct({
      deal_date: rent_deals.deal_date, addr_key: rent_deals.addr_key,
      floor_no: rent_deals.floor_no, total_floors: rent_deals.total_floors,
      area_ping: rent_deals.area_ping, rooms: rent_deals.rooms, halls: rent_deals.halls,
      rental_type: rent_deals.rental_type, building_type: rent_deals.building_type,
      build_year: rent_deals.build_year,
      monthly_rent: rent_deals.monthly_rent, housing_rent: rent_deals.housing_rent,
      parking_rent: rent_deals.parking_rent, rent_per_ping: rent_deals.rent_per_ping,
      is_social: rent_deals.is_social,
    }).from(rent_deals)
      .innerJoin(building_community, eq(building_community.addr_key, rent_deals.addr_key))
      .where(inArray(building_community.case_no, caseNos))
      .orderBy(desc(rent_deals.deal_date)).limit(400);
    rents = rentRows.map(({ addr_key, ...r }) => ({ ...r, addr: stripAddr(addr_key) }));
  }

  const metrics = await getProjectMetrics()
    .then((m) => m.get(projectKey(city, district, name)) ?? null)
    .catch((e) => { console.error("[project-detail] metrics failed", e); return null; });

  return {
    project: p,
    metrics,
    community: comm && {
      households: totalHouseholds, street: comm.street, permit_no: comm.permit_no,
      first_reg: comm.first_reg, declare_date: comm.declare_date,
      use_issue_date: comm.use_issue_date, phases: comms.length,
    },
    band: completed ? ageBand(regYear, nowYear) : "presale",
    build_year: completed ? regYear : null,
    deals,
    resales,
    unit_doors: unitDoors,
    rents,
    materials,
  };
}

export type ProjectDetail = NonNullable<Awaited<ReturnType<typeof loadProjectDetail>>>;
