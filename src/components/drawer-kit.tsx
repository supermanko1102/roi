import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CANCEL_MIN_TOTAL, DEV_MIN_OWN_DEALS, devLabel, devWord, type ProjectMetrics } from "@/lib/metrics-core";

// 成交單價顯示：整數不帶小數，其餘保留一位。
export const fmtP = (v: number) => (Math.round(v * 10) / 10).toString();

// 建案/租賃抽屜共用的明細表頭樣式與小元件
export const dealsTh = "border-b border-line px-1.5 py-[5px] text-left text-[9.5px] font-bold text-ink-soft";

export function shortRocDate(iso: string | null): string {
  if (!iso) return "—";
  const [year, month, day] = iso.split("-");
  return `${Number(year) - 1911}/${month}/${day}`;
}

export function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-[#e4e8e5] bg-white p-2.5">
      <span className="mb-1 block text-[9px] text-ink-soft">{label}</span>
      <b className="num block text-[11px] font-bold wrap-anywhere">{value == null || value === "" ? "—" : value}</b>
    </div>
  );
}

export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** 租約明細列(租賃抽屜與建案抽屜「本社區租約」共用) */
export type RLease = {
  deal_date: string | null; addr: string | null;
  floor_no: number | null; total_floors: number | null;
  area_ping: number | null; rooms: number | null; halls: number | null;
  rental_type: string | null; building_type: string | null; build_year: number | null;
  monthly_rent: number | null; housing_rent: number | null;
  parking_rent: number | null; rent_per_ping: number | null;
  is_social: boolean | null;
};

export function LeaseTable({ rows, cap }: { rows: RLease[]; cap: number }) {
  return (
    <>
      <div className="mt-2 overflow-x-auto rounded-[10px] border border-line">
        <table className="num w-full table-fixed border-collapse text-[10.5px]">
          <colgroup>
            <col className="w-[82px] max-mob:w-[72px]" />
            <col />
            <col className="w-[92px] max-mob:w-[80px]" />
            <col className="w-[96px] max-mob:w-[86px]" />
          </colgroup>
          <thead>
            <tr>
              <th className={dealsTh}>日期</th>
              <th className={dealsTh}>門牌・樓層</th>
              <th className={dealsTh}>格局・坪數</th>
              <th className={dealsTh}>月租</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, cap).map((l, i) => (
              <tr key={i} className="align-top even:bg-[#f5f7f4]">
                <td className="whitespace-nowrap p-1.5">
                  <span className="max-mob:hidden">{l.deal_date ?? "—"}</span>
                  <span className="hidden max-mob:inline">{shortRocDate(l.deal_date)}</span>
                </td>
                <td className="p-1.5">
                  <b className="block font-extrabold text-ink wrap-anywhere">{l.addr ?? "門牌未登錄"}</b>
                  <small className="mt-0.5 block text-[8.5px] text-ink-soft">
                    {[l.floor_no != null ? `${l.floor_no}樓${l.total_floors ? `/${l.total_floors}` : ""}` : null,
                      l.rental_type].filter(Boolean).join("・") || "樓層未登錄"}
                  </small>
                </td>
                <td className="whitespace-nowrap p-1.5">
                  {l.rooms != null && l.rooms > 0 ? `${l.rooms}房${l.halls ? `${l.halls}廳` : ""}` : "—"}
                  <small className="mt-0.5 block text-[8.5px] text-ink-soft">
                    {l.area_ping == null ? "坪數 —" : `${(+l.area_ping).toFixed(1)} 坪`}
                  </small>
                </td>
                <td className="whitespace-nowrap p-1.5">
                  <b className="block font-bold text-ink">
                    {l.monthly_rent == null ? "—" : `${Math.round(l.monthly_rent).toLocaleString()} 元`}
                  </b>
                  <small className="mt-0.5 block text-[8.5px] text-ink-soft">
                    {l.rent_per_ping == null ? "每坪 —" : `每坪 ${Math.round(l.rent_per_ping).toLocaleString()} 元`}
                    {l.parking_rent != null && l.parking_rent > 0 ? `・含車位 ${Math.round(l.parking_rent).toLocaleString()}` : ""}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > cap && <div className="mt-[7px] text-right text-[9px] text-ink-soft">顯示最近 {cap} 筆</div>}
    </>
  );
}

function InsightRow({ kicker, tone, headline, children }: {
  kicker: string; tone?: "up" | "down" | "warn" | "muted"; headline: ReactNode; children: ReactNode;
}) {
  return (
    <div className="border-t border-[#e4e8e5] px-3.5 py-3 first:border-t-0">
      <div className="text-[9.5px] font-extrabold tracking-[.08em] text-ink-soft">{kicker}</div>
      <div className={cn(
        "mt-1 text-[15px] font-extrabold leading-snug text-ink",
        tone === "up" && "text-[#a23e2d]", tone === "down" && "text-teal",
        tone === "warn" && "text-[#a23e2d]", tone === "muted" && "text-[13px] font-bold text-ink-soft",
      )}>{headline}</div>
      <div className="mt-1 text-[10px] leading-[1.65] text-ink-soft">{children}</div>
    </div>
  );
}

/**
 * 建案抽屜的三個判讀:跟附近比、出租回報、解約。
 * 每一列都寫明「跟誰比、幾筆樣本」;算不出來就直說原因,不顯示推估值。
 */
export function ProjectInsights({ metrics, unitPrice, deals, cancels }: {
  metrics: ProjectMetrics | null; unitPrice: number | null; deals: number; cancels: number;
}) {
  if (!metrics) return null;
  const m = metrics;
  const word = m.dev == null ? null : devWord(m.dev);
  const yieldPrice = m.recent_n >= DEV_MIN_OWN_DEALS && m.recent_price != null ? m.recent_price : unitPrice;
  const total = deals + cancels;
  return (
    <section className="mb-[11px] overflow-hidden rounded-[14px] border border-[#e4e8e5] bg-white" aria-label="這個案子的三個判讀">
      <InsightRow kicker="跟附近比" tone={word === "貴" ? "up" : word === "便宜" ? "down" : m.dev == null ? "muted" : undefined}
        headline={m.dev == null ? "目前沒辦法比"
          : word === "差不多" ? `和${m.dev_base}其他預售案差不多`
          : `比${m.dev_base}其他預售案${devLabel(m.dev)}`}>
        {m.dev == null ? (
          m.recent_n < DEV_MIN_OWN_DEALS
            ? `本案近一年只有 ${m.recent_n} 筆成交，樣本太少；拿幾年前的成交價跟現在比沒有意義，所以不比。`
            : "附近近一年有成交的其他預售案不夠多（或價差大到不像同類產品），不硬比。"
        ) : (
          <>
            本案近一年一坪約 <b className="num text-ink">{fmtP(m.recent_price!)}</b> 萬（{m.recent_n} 筆）；
            {m.dev_scope === "zone" ? "同生活圈" : "同行政區"}其他 {m.dev_projects} 個案一坪約{" "}
            <b className="num text-ink">{fmtP(m.dev_price!)}</b> 萬（{m.dev_deals} 筆）。
            {m.dev_scope === "district" && "這一帶生活圈內可比的案不夠，改跟整個行政區比，地段差異會比較大。"}
            未區分坪數與樓層。
          </>
        )}
      </InsightRow>
      <InsightRow kicker="買來出租" tone={m.yield_pct == null ? "muted" : undefined}
        headline={m.yield_pct == null ? "附近租約太少，算不出來"
          : <>一年租金約為房價的 <span className="num">{m.yield_pct.toFixed(1)}%</span></>}>
        {m.yield_pct == null ? "本社區與附近 2.5 公里內，屋齡 1–10 年的住宅租約不到 5 筆。" : (
          <>
            {m.yield_src === "community"
              ? `本社區近三年實際租約 ${m.yield_n} 筆`
              : `附近 ${m.yield_radius_m && m.yield_radius_m > 1000 ? "2.5" : "1"} 公里內屋齡 1–10 年住宅租約 ${m.yield_n} 筆`}
            ，每坪月租約 <b className="num text-ink">{m.yield_rent?.toLocaleString()}</b> 元
            {yieldPrice != null && <>；對照本案一坪 <b className="num text-ink">{fmtP(yieldPrice)}</b> 萬</>}。
            未扣稅、管理費、裝潢與空租期，實拿會更低。
          </>
        )}
      </InsightRow>
      <InsightRow kicker="買了又解約" tone={cancels > 0 && (m.cancel_rate ?? 0) >= 5 ? "warn" : cancels === 0 ? "muted" : undefined}
        headline={cancels === 0 ? "沒有解約紀錄"
          : <>{total} 筆裡有 <span className="num">{cancels}</span> 筆解約{m.cancel_rate != null ? `（${m.cancel_rate.toFixed(1)}%）` : ""}</>}>
        {cancels === 0 ? "實價登錄未見本案解約註記。"
          : total < CANCEL_MIN_TOTAL ? "成交筆數還少，比例僅供參考；明細在「成交」分頁最下方。"
          : "解約的成交不計入上面的價格；明細在「成交」分頁最下方。"}
      </InsightRow>
    </section>
  );
}
