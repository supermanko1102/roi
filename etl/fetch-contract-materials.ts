/**
 * 預售定型化契約「建材設備表」抓取 → contract_materials(增量)
 *
 * 流程(偵察紀錄見 memory presale-contract-recon):
 *   1. lvr.land.moi.gov.tw「預售屋建案查詢」查詢 API 參數是前端 AES 加密,
 *      故用 playwright 走真實 UI:逐建案搜尋 → 開「申報人及定型化契約」彈窗
 *      → 收 mlvr.land.moi.gov.tw/download/{案號}/{檔名}.pdf 直鏈(此鏈 curl 可直下)。
 *   2. 挑「房屋」契約、取最高版次(-01 > -00),fetch 下載(快取於 downloads/contracts/)。
 *   3. pdftotext -layout(需 poppler;GHA 以 apt 安裝)→ 依頁首「附件…建材設備表」
 *      切出附件全文,再按「※分類」切節,存全文+JSON 分節。
 *   4. 抓不到列(備查名與實登名不一致或尚未備查)記 no_case;PDF 無建材表記 no_materials。
 *      這兩類與 fetch_failed 超過 RETRY_DAYS 天後會重試。
 *
 * 用法:tsx etl/fetch-contract-materials.ts [--limit 60] [--city 桃園市] [--project 名稱] [--retry]
 *   每旬 cron 帶預設值即可:先補新建案,舊失敗案慢慢重試,單次上限避免超時。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { sql } from "drizzle-orm";
import { chromium, type Page } from "playwright";
import { createDb, contract_materials } from "../db/client";
import { CITIES } from "../src/lib/cities";

const CACHE_DIR = path.join(import.meta.dirname, "downloads", "contracts");
const ENTRY = "https://lvr.land.moi.gov.tw/jsp/index.jsp";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const RETRY_DAYS = 30;
const SLEEP_MS = 1800;

const args = process.argv.slice(2);
const argOf = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const LIMIT = +(argOf("--limit") ?? 60);
const WORKERS = +(argOf("--workers") ?? 4);
const ONLY_CITY = argOf("--city");
const ONLY_PROJECT = argOf("--project");
const FORCE_RETRY = args.includes("--retry");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Target = { city: string; district: string; project_name: string };
type ContractLink = { url: string; caseNo: string; filename: string };

/** 從彈窗連結挑最適合的房屋契約:優先含「房屋」,再取案號版次最大、日期字串最大 */
/**
 * 建材表可能在任何一冊(建商常拆本文/附件、房屋/土地多份 PDF),
 * 依「含房屋 → 非土地 → 土地」優先序排序,呼叫端逐冊試抽直到命中。
 */
function rankContracts(links: ContractLink[]): ContractLink[] {
  const tier = (l: ContractLink) =>
    /房屋|房地/.test(l.filename) ? 0 : /土地/.test(l.filename) ? 2 : 1;
  return [...new Map(links.map((l) => [l.url, l])).values()].sort((a, b) =>
    tier(a) - tier(b) || b.caseNo.localeCompare(a.caseNo) || b.filename.localeCompare(a.filename));
}

const firstLine = (p: string) => (p.split("\n").map((l) => l.trim()).find(Boolean) ?? "");
// layout 模式頁首常夾大量對齊空白,摺疊後才好比對(附件（六）……建材設備表)
const headOf = (p: string) =>
  p.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 2).join(" ").replace(/\s+/g, " ");

/**
 * pdftotext 頁文切出「建材設備表」附件。
 * 候選起點=頁首含「建材設備」且非「第X條 建材設備及其廠牌」條文頁
 * (標題寫法各家不同:附件六建材設備表/附表四/建材設備表 單獨成行…),
 * 迄點=下一個「附件/附表」開頭的頁首;逐候選試切,取內容最長者。
 */
function extractMaterials(pdfPath: string): string | null {
  const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
    maxBuffer: 64 * 1024 * 1024,
  }).toString("utf-8");
  const pages = text.split("\f");
  const isClause = (h: string) => /第\s*[一二三四五六七八九十\d]+\s*條/.test(h);
  const candidates = pages
    .map((p, i) => ({ i, head: headOf(p) }))
    .filter((x) => /建材設備/.test(x.head) && !isClause(x.head));
  let best = "";
  for (const { i } of candidates) {
    const out = [pages[i]];
    for (let j = i + 1; j < pages.length; j++) {
      const fl = firstLine(pages[j]);
      if (/^附[件表]/.test(fl) && !/建材設備/.test(headOf(pages[j]))) break;
      out.push(pages[j]);
    }
    const body = out.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (body.length > best.length) best = body;
  }
  return best.length > 300 ? best : null; // 過短多半是留白範本頁
}

/** 依「※分類標題」切節。※ 可能與附件標題同一行(附件六 建材設備表 ※結構),
 *  也可能整行只有「※ 結 構」;標題內含空白一律去掉。無 ※ 時整段單節。 */
function toSections(text: string): { title: string; body: string }[] {
  type Sec = { title: string; body: string[] };
  const sections: Sec[] = [];
  for (const raw of text.split("\n")) {
    const idx = raw.indexOf("※");
    const cur = sections[sections.length - 1];
    if (idx >= 0) {
      const before = raw.slice(0, idx).trim();
      const title = raw.slice(idx + 1).trim();
      if (cur && before) cur.body.push(before);      // ※ 前若有殘留內文(同行附件標題)保留
      if (title.length <= 25) { sections.push({ title: title.replace(/\s+/g, ""), body: [] }); continue; }
    }
    if (cur) cur.body.push(raw);
  }
  if (!sections.length) return [{ title: "建材設備表", body: text.trim() }];
  return sections
    .map((s) => ({ title: s.title, body: s.body.join("\n").replace(/\n{3,}/g, "\n\n").trim() }))
    .filter((s) => s.title && s.body);
}

/** lvr UI:切到建案查詢分頁並等表單就緒。
 * 城市下拉在不同版型 ID 不同(桌面 #p_city、窄版 #l_city),一律挑可見者。
 * lvr 伺服器偶爾回應慢致 page.goto 逾時,每案都重載故重試 3 次以吸收暫時性延遲。 */
async function gotoSaleRemark(page: Page) {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(ENTRY, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForFunction(() => typeof (window as any).changeType === "function", { timeout: 30_000 });
      await sleep(1500);
      await page.evaluate(() => (window as any).changeType("saleRemark"));
      await page.waitForSelector("#p_build", { state: "attached", timeout: 30_000 });
      await sleep(800);
      return;
    } catch (e) { lastErr = e; await sleep(2000 * attempt); }
  }
  throw lastErr;
}

/** 查一個建案,回傳其契約連結(找不到列回 null) */
async function queryProject(page: Page, lvrCity: string, t: Target): Promise<ContractLink[] | null> {
  await page.evaluate(({ city, name }) => {
    const c = [...document.querySelectorAll<HTMLSelectElement>("#p_city, #l_city")]
      .find((e) => e.offsetParent) ?? document.querySelector<HTMLSelectElement>("#p_city")!;
    c.value = city; c.dispatchEvent(new Event("change", { bubbles: true }));
    const b = document.querySelector("#p_build") as HTMLInputElement;
    b.value = name; b.dispatchEvent(new Event("input", { bubbles: true }));
  }, { city: lvrCity, name: t.project_name });
  await sleep(300);
  // 搜尋鈕綁 jQuery click 且會檢查 isTrusted 之外的自動化訊號,用真實滑鼠點擊
  await page.locator('a.btn.form-button:visible', { hasText: "搜尋" }).first().click();
  // 等含建案名的結果列出現;結果區初始即顯示「無資料」,不能拿它當完成訊號,逾時即視為查無
  try {
    await page.waitForFunction((name) =>
      [...document.querySelectorAll("tr")].some((r) =>
        r.querySelector("button.remarkdetail") && (r.textContent ?? "").includes(name)),
      t.project_name, { timeout: 15_000 });
  } catch { return null; }

  // 名稱全等優先、其次包含;同名多列以坐落街道的行政區前綴斷開。
  // 注意:傳入 page.evaluate 的函式不可宣告內部具名函式(esbuild keepNames 會注入
  // 瀏覽端不存在的 __name),故此處全部用 inline 表達式。
  const found = await page.evaluate(({ name, district }) => {
    const scored = [...document.querySelectorAll("tr")]
      .filter((r) => r.querySelector("button.remarkdetail"))
      .map((r) => {
        const cells = [...r.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim());
        const exact = cells[0] === name ? 2 : (cells[0] ?? "").includes(name) ? 1 : 0;
        const s = exact === 0 ? -1 : exact * 10 + ((cells[1] ?? "").startsWith(district) ? 1 : 0);
        return { r, s };
      })
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s);
    if (!scored.length) return false;
    (scored[0].r.querySelector("button.remarkdetail") as HTMLElement).click();
    return true;
  }, { name: t.project_name, district: t.district });
  if (!found) return null;

  try {
    await page.waitForSelector('a[href*="mlvr.land.moi.gov.tw/download"]', { timeout: 15_000 });
  } catch { return null; }
  await sleep(300);
  const links: ContractLink[] = await page.evaluate(() =>
    [...document.querySelectorAll('a[href*="mlvr.land.moi.gov.tw/download"]')].map((a) => {
      const url = (a as HTMLAnchorElement).href;
      const parts = decodeURIComponent(new URL(url).pathname).split("/");
      return { url, caseNo: parts[2] ?? "", filename: parts[3] ?? "" };
    }));
  // 不關彈窗:呼叫端每案都會 gotoSaleRemark 重載,避免彈窗殘留破壞下一輪表單
  return links;
}

async function downloadPdf(link: ContractLink, cacheKey: string): Promise<string> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${cacheKey}.pdf`);
  if (fs.existsSync(file) && fs.statSync(file).size > 10_000) return file;
  const res = await fetch(link.url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`PDF HTTP ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

async function main() {
  const { db, pool } = createDb();
  try {
    // 目標:presale_deals 有成交的建案 − 已成功/近期試過的
    const cutoff = new Date(Date.now() - RETRY_DAYS * 864e5).toISOString();
    const targets: Target[] = (await db.execute(sql`
      SELECT DISTINCT p.city, p.district, p.project_name
      FROM presale_deals p
      LEFT JOIN contract_materials m
        ON m.city = p.city AND m.district = p.district AND m.project_name = p.project_name
      WHERE p.project_name IS NOT NULL AND p.project_name <> ''
        AND (m.id IS NULL OR (m.status <> 'ok' AND (${FORCE_RETRY ? sql`true` : sql`m.fetched_at < ${cutoff}`})))
        ${ONLY_CITY ? sql`AND p.city = ${ONLY_CITY}` : sql``}
        ${ONLY_PROJECT ? sql`AND p.project_name = ${ONLY_PROJECT}` : sql``}
      ORDER BY p.city, p.district, p.project_name
      LIMIT ${LIMIT}
    `)).rows as unknown as Target[];
    console.log(`[contracts] 待處理 ${targets.length} 案(limit ${LIMIT})`);
    if (!targets.length) return;

    // lvr 的搜尋按鈕會檢查 navigator.webdriver,偵測到自動化就靜默不查詢 → 需隱藏
    const browser = await chromium.launch({ args: ["--disable-blink-features=AutomationControlled"] });
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() =>
      Object.defineProperty(navigator, "webdriver", { get: () => undefined }));

    let ok = 0, noCase = 0, noMat = 0, failed = 0;
    // 多分頁平行搶隊列:瓶頸在每案的 UI 查詢往返(~10s),平行 N 個約快 N 倍。
    // 上限保守(預設 4)+ 每案間隔加抖動,對政府網站維持一般使用者等級的請求量。
    const queue = [...targets];
    const worker = async (page: Page) => {
      for (;;) {
        const t = queue.shift();
        if (!t) return;
        await processTarget(page, t);
        await sleep(SLEEP_MS + Math.random() * 900);
      }
    };
    const processTarget = async (page: Page, t: Target) => {
      const cityCode = CITIES.find((c) => c.name === t.city)?.code.toUpperCase();
      if (!cityCode) return;
      const label = `${t.city}${t.district}「${t.project_name}」`;
      const save = async (row: Partial<typeof contract_materials.$inferInsert>) => {
        await db.insert(contract_materials)
          .values({ city: t.city, district: t.district, project_name: t.project_name, status: "fetch_failed", ...row })
          .onConflictDoUpdate({
            target: [contract_materials.city, contract_materials.district, contract_materials.project_name],
            set: { ...row, fetched_at: new Date() },
          });
      };
      try {
        // 每案都重載表單:彈窗互動會破壞頁面狀態,靠重載保證下一輪 #p_city/#p_build 乾淨
        await gotoSaleRemark(page);
        const links = await queryProject(page, cityCode, t);
        const ranked = rankContracts(links ?? []);
        if (!ranked.length) { noCase++; console.log(`  − ${label} 查無備查列/契約`); await save({ status: "no_case" }); return; }
        const cacheKey = `${cityCode}-${t.district}-${t.project_name}`.replace(/[\\/:*?"<>|\s]/g, "_");
        // 建材表可能在任一冊:逐冊(最多 5 份)下載試抽,命中即停
        let hit: { link: ContractLink; materials: string } | null = null;
        for (const link of ranked.slice(0, 5)) {
          const fileKey = link.filename.replace(/[\\/:*?"<>|\s]/g, "_").slice(0, 40);
          const pdf = await downloadPdf(link, `${cacheKey}-${fileKey}`);
          const materials = extractMaterials(pdf);
          if (materials) { hit = { link, materials }; break; }
        }
        if (!hit) {
          const first = ranked[0];
          noMat++; console.log(`  − ${label} ${ranked.length} 冊皆無建材設備表`);
          await save({ status: "no_materials", mlvr_case_no: first.caseNo, pdf_url: first.url, version_note: first.filename });
          return;
        }
        await save({
          status: "ok", mlvr_case_no: hit.link.caseNo, pdf_url: hit.link.url,
          version_note: hit.link.filename, materials_text: hit.materials,
          sections: JSON.stringify(toSections(hit.materials)),
        });
        ok++; console.log(`  ✓ ${label} ${hit.link.caseNo}(${Math.round(hit.materials.length / 100) / 10}k 字)`);
      } catch (e) {
        failed++; console.log(`  ✗ ${label} ${String(e).slice(0, 120)}`);
        await save({ status: "fetch_failed" });
      }
    };

    const pages = await Promise.all(
      Array.from({ length: Math.min(WORKERS, queue.length) }, () => ctx.newPage()));
    await Promise.all(pages.map(worker));
    await browser.close();
    console.log(`[contracts] 完成:ok ${ok}、無備查 ${noCase}、無建材表 ${noMat}、失敗 ${failed}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
