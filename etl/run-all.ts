import { spawn } from "node:child_process";
import { eq } from "drizzle-orm";
import { createDb, etl_runs } from "../db/client";
import {
  collectQualityMetrics, evaluateQuality, latestSuccessfulMetrics, writeActionsSummary,
} from "./quality-check";

const STEPS = [
  "etl:download", "etl:parse", "etl:fix-names", "etl:geocode", "etl:stats", "etl:use-permits",
  "etl:communities", "etl:geocode-projects", "etl:geocode-lots", "etl:repair-projects", "etl:zone-bands",
  "etl:rent-benchmarks", "etl:zone-rents",
];

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
