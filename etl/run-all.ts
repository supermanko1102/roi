import { spawn } from "node:child_process";
import { eq } from "drizzle-orm";
import { createDb, etl_runs } from "../db/client";
import {
  collectQualityMetrics, evaluateQuality, latestSuccessfulMetrics, writeActionsSummary,
} from "./quality-check";

const ALL_STEPS = [
  "etl:download", "etl:parse", "etl:fix-names", "etl:geocode", "etl:stats", "etl:use-permits",
  "etl:communities", "etl:geocode-projects", "etl:geocode-lots", "etl:match-leju", "etl:presale-doors",
  "etl:permit-doors",
  "etl:repair-projects", "etl:zone-bands",
  "etl:rent-benchmarks", "etl:zone-rents",
];

// ETL_STEPS=etl:a,etl:b 只跑指定步驟(手動回填用;非發布日全跑會被 parse 短路擋掉)。
// 只接受白名單內的步驟名,依 ALL_STEPS 原順序執行。
const requested = (process.env.ETL_STEPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const unknown = requested.filter((s) => !ALL_STEPS.includes(s));
if (unknown.length) throw new Error(`未知步驟:${unknown.join(", ")}`);
const STEPS = requested.length ? ALL_STEPS.filter((s) => requested.includes(s)) : ALL_STEPS;

function runScript(name: string): Promise<string> {
  console.log(`\n[etl-run] ${name}`);
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", [name], { env: process.env, stdio: ["inherit", "pipe", "pipe"] });
    let output = "";
    const forward = (target: NodeJS.WriteStream) => (chunk: Buffer) => {
      target.write(chunk);
      output = (output + chunk.toString()).slice(-200_000);
    };
    child.stdout.on("data", forward(process.stdout));
    child.stderr.on("data", forward(process.stderr));
    child.on("error", reject);
    child.on("exit", (code) => code === 0
      ? resolve(output)
      : reject(new Error(`${name} exited with code ${code ?? "unknown"}`)));
  });
}

async function main() {
  const { db, pool } = createDb();
  const previous = await latestSuccessfulMetrics(db);
  const [run] = await db.insert(etl_runs).values({
    workflow: process.env.ETL_WORKFLOW ?? "etl:all",
    status: "running",
    git_sha: process.env.GITHUB_SHA ?? null,
  }).returning({ id: etl_runs.id });

  let fallbackHits: number | undefined;
  let collectedMetrics: Awaited<ReturnType<typeof collectQualityMetrics>> | null = null;
  try {
    for (const step of STEPS) {
      const output = await runScript(step);
      // 每日 cron 空跑短路:parse 把所有批次都判為重複(MOI 未更新)且沒有任何
      // 城市入庫時,後續統計/定位/歸戶全是無效重算,直接提前收工
      if (step === "etl:parse"
          && /內容與同季既有批次完全重複/.test(output)
          && !/(買賣|預售|租賃) \d+ 筆/.test(output)) {
        console.log("[etl-run] 無新資料(MOI 尚未更新),提前收工");
        break;
      }
      if (step === "etl:geocode-projects") {
        const match = output.match(/fallback=(\d+)/g)?.at(-1)?.match(/\d+/);
        if (match) fallbackHits = Number(match[0]);
      }
    }
    const metrics = await collectQualityMetrics(db, fallbackHits);
    collectedMetrics = metrics;
    const { errors, warnings } = evaluateQuality(metrics, previous);
    writeActionsSummary(metrics, errors, warnings);
    if (errors.length) throw new Error(`資料品質檢查失敗：${errors.join("；")}`);
    await db.update(etl_runs).set({
      status: "success", completed_at: new Date(), metrics, error: null,
    }).where(eq(etl_runs.id, run.id));
    console.log(`[etl-run] success run=${run.id}${warnings.length ? ` warnings=${warnings.length}` : ""}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.update(etl_runs).set({
      status: "failed", completed_at: new Date(), metrics: collectedMetrics, error: message,
    }).where(eq(etl_runs.id, run.id));
    throw e;
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
