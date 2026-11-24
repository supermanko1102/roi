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
export function ProjectInsights({ metrics, unitPrice, deals, cancels, located }: {
  metrics: ProjectMetrics | null; unitPrice: number | null; deals: number; cancels: number; located: boolean;
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
        headline={m.yield_pct == null ? (located ? "附近租約太少，算不出來" : "位置未確認，算不出來")
          : <>一年租金約為房價的 <span className="num">{m.yield_pct.toFixed(1)}%</span></>}>
        {m.yield_pct == null ? (located
          ? "本社區與附近 2.5 公里內，屋齡 1–10 年的住宅租約不到 5 筆。"
          : "這個案的位置還沒確認，沒辦法找附近的租約來換算。") : (
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

// ── 價格走勢:預售期逐季中位單價,交屋後接轉售,同一條時間軸 ──────────────

type TimelineDeal = { deal_date: string | null; unit_price: number | null };
type QuarterPoint = { t: number; label: string; price: number; n: number };

/** 逐季中位單價;單季筆數不到 minN 就不畫,免得一兩筆高價戶做出假漲幅 */
export function quarterMedians(deals: TimelineDeal[], minN: number): QuarterPoint[] {
  const buckets = new Map<string, number[]>();
  for (const d of deals) {
    if (!d.deal_date || d.unit_price == null || +d.unit_price <= 0) continue;
    const [y, m] = d.deal_date.split("-").map(Number);
    if (!y || !m) continue;
    const key = `${y}-${Math.floor((m - 1) / 3)}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(+d.unit_price);
  }
  return [...buckets.entries()]
    .filter(([, prices]) => prices.length >= minN)
    .map(([key, prices]) => {
      const [y, q] = key.split("-").map(Number);
      return { t: y + (q + 0.5) / 4, label: `${y - 1911}年Q${q + 1}`, price: median(prices)!, n: prices.length };
    })
    .sort((a, b) => a.t - b.t);
}

const yearFraction = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return y + ((m - 1) + ((d || 15) - 1) / 31) / 12;
};

const TL = { w: 340, h: 132, l: 30, r: 12, t: 12, b: 22 };

export function PriceTimeline({ deals, resales, handover }: {
  deals: TimelineDeal[]; resales: TimelineDeal[]; handover: string | null;
}) {
  const pre = quarterMedians(deals, 3);
  const post = quarterMedians(resales, 3);
  const all = [...pre, ...post];
  if (pre.length < 3 && (pre.length < 1 || post.length < 1)) return null;

  const hx = handover && post.length ? yearFraction(handover) : null;
  const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t), t0 + 0.5);
  const lo = Math.min(...all.map((p) => p.price)), hi = Math.max(...all.map((p) => p.price));
  const pad = Math.max((hi - lo) * 0.15, hi * 0.03);
  const yMin = lo - pad, yMax = hi + pad;
  const x = (t: number) => TL.l + ((t - t0) / (t1 - t0)) * (TL.w - TL.l - TL.r);
  const y = (v: number) => TL.t + (1 - (v - yMin) / (yMax - yMin)) * (TL.h - TL.t - TL.b);
  const line = (pts: QuarterPoint[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
  const years: number[] = [];
  for (let yr = Math.ceil(t0); yr <= Math.floor(t1); yr++) years.push(yr);
  const yearStep = Math.max(1, Math.ceil(years.length / 5));

  const first = pre[0], last = pre[pre.length - 1];
  const change = pre.length >= 2 ? (last.price / first.price - 1) * 100 : null;
  const dir = change == null ? null : Math.abs(change) < 2 ? "幾乎沒變" : change > 0 ? "漲" : "跌";

  return (
    <section className="mt-[21px]" aria-label="價格走勢">
      <div className="text-[13.5px] font-extrabold">價格怎麼走</div>
      {change != null && (
        <p className="mt-1.5 text-[11px] leading-[1.6] text-ink-soft">
          預售期間一坪從 <b className="num text-ink">{fmtP(first.price)}</b> 萬（{first.label}）
          {dir === "幾乎沒變" ? "到" : dir === "漲" ? "漲到" : "跌到"} <b className="num text-ink">{fmtP(last.price)}</b> 萬（{last.label}）
          {dir !== "幾乎沒變" && <>，{dir}了 <b className="num text-ink">{Math.abs(change).toFixed(0)}%</b></>}。
          {post.length > 0 && <> 交屋後轉手最近一季一坪約 <b className="num text-ink">{fmtP(post[post.length - 1].price)}</b> 萬。</>}
        </p>
      )}
      <div className="mt-2 rounded-[12px] border border-line bg-white px-2 pb-1.5 pt-2">
        <svg viewBox={`0 0 ${TL.w} ${TL.h}`} className="block w-full" role="img"
          aria-label={`逐季成交單價:預售 ${pre.length} 季${post.length ? `、轉售 ${post.length} 季` : ""}`}>
          {[yMin + pad, yMax - pad].map((v, i) => (
            <g key={i}>
              <line x1={TL.l} x2={TL.w - TL.r} y1={y(v)} y2={y(v)} stroke="#e8ece9" strokeWidth="1" />
              <text x={TL.l - 5} y={y(v) + 3} textAnchor="end" fontSize="8.5" fill="#62716c">{fmtP(v)}</text>
            </g>
          ))}
          {years.filter((_, i) => i % yearStep === 0).map((yr) => (
            <text key={yr} x={x(yr)} y={TL.h - 7} textAnchor="middle" fontSize="8.5" fill="#62716c">{yr - 1911}年</text>
          ))}
          {hx != null && hx > t0 && hx < t1 && (
            <g>
              <line x1={x(hx)} x2={x(hx)} y1={TL.t} y2={TL.h - TL.b} stroke="#a76f1d" strokeWidth="1" strokeDasharray="3 3" />
              <text x={x(hx) + 3} y={TL.t + 7} fontSize="8.5" fontWeight="700" fill="#a76f1d">交屋</text>
            </g>
          )}
          {pre.length > 1 && <path d={line(pre)} fill="none" stroke="#0d5b4f" strokeWidth="1.8" strokeLinejoin="round" />}
          {post.length > 1 && <path d={line(post)} fill="none" stroke="#a76f1d" strokeWidth="1.8" strokeLinejoin="round" />}
          {pre.map((p) => (
            <circle key={`a${p.t}`} cx={x(p.t)} cy={y(p.price)} r="2.6" fill="#0d5b4f">
              <title>{`${p.label} 預售 ${fmtP(p.price)} 萬/坪(${p.n} 筆)`}</title>
            </circle>
          ))}
          {post.map((p) => (
            <circle key={`b${p.t}`} cx={x(p.t)} cy={y(p.price)} r="2.6" fill="#fff" stroke="#a76f1d" strokeWidth="1.8">
              <title>{`${p.label} 轉售 ${fmtP(p.price)} 萬/坪(${p.n} 筆)`}</title>
            </circle>
          ))}
        </svg>
        <div className="flex flex-wrap items-center gap-x-3 px-1 text-[9px] text-ink-soft">
          <span><i className="mr-1 inline-block size-[7px] rounded-full bg-teal align-middle" />預售成交</span>
          {post.length > 0 && <span><i className="mr-1 inline-block size-[7px] rounded-full border-[1.5px] border-amber bg-white align-middle" />交屋後轉售</span>}
          <span className="ml-auto">每點＝一季中位單價（萬／坪）</span>
        </div>
      </div>
      <p className="mt-1.5 text-[9px] leading-normal text-ink-soft">
        單季不到 3 筆的季別不畫。前後期賣的樓層與坪數可能不同，漲跌不等於同一戶的增值。
      </p>
    </section>
  );
}

const MATCH_LABEL: Record<string, string> = {
  parcel: "地號比對", "leju-door": "建案門牌查證", "presale-door": "預售登錄的門牌", "permit-door": "使用執照門牌清單",
  neighbor: "鄰棟推定",
};

/** 資料可信度:位置是否確認、轉售/租約是怎麼對到這個案的 */
export function DataConfidence({ located, matching, firstHandExcluded = 0 }: {
  located: boolean; matching: { method: string | null; doors: number; min_confidence: number }[];
  firstHandExcluded?: number;
}) {
  const doors = matching.reduce((sum, m) => sum + m.doors, 0);
  const weakest = matching.length ? Math.min(...matching.map((m) => m.min_confidence)) : 100;
  if (located && doors === 0) return null;
  return (
    <section className="mt-[21px]" aria-label="資料可信度">
      <div className="text-[13.5px] font-extrabold">這些資料有多可靠</div>
      <ul className="mt-2 space-y-1.5 text-[10.5px] leading-[1.65] text-ink-soft">
        {!located && (
          <li className="rounded-[10px] border border-[#ecdec2] bg-[#fffaf0] px-3 py-2 text-[#785415]">
            <b>位置還沒確認。</b>登錄的地址只寫到路段或地號，找不到確切門牌，所以這個案不在地圖上；成交紀錄不受影響。
          </li>
        )}
        {doors > 0 && (
          <li className="rounded-[10px] border border-line bg-white px-3 py-2">
            <b className="text-ink">轉售與租約是用門牌對回本案的</b>，共 <b className="num text-ink">{doors}</b> 個門牌（
            {matching.map((m) => `${MATCH_LABEL[m.method ?? "parcel"] ?? m.method} ${m.doors}`).join("、")}）。
            {weakest < 100
              ? ` 其中部分是依鄰近位置與完工年推定，把握度約 ${weakest}/100，可能混入隔壁棟。`
              : " 都是官方登錄可直接對應的門牌。"}
          </li>
        )}
        {firstHandExcluded > 0 && (
          <li className="rounded-[10px] border border-line bg-white px-3 py-2">
            <b className="text-ink">轉售只算真的轉手。</b>另有 <b className="num text-ink">{firstHandExcluded}</b> 筆是交屋時建商過戶給原買方的紀錄，
            價格是幾年前簽約時談的，不是現在的行情，所以沒有算進轉售。
          </li>
        )}
      </ul>
    </section>
  );
}
