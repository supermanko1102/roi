import { type ReactNode } from "react";

// 抽屜共用元件與白話文案工具。
// 文案原則:給一般人看——不用「中位數/P25/口徑」,說「一坪約」「多數人成交在」「比附近便宜」。

// 走勢圖/季中位的最小輸入形狀
export type PricePoint = { deal_date: string | null; unit_price: number | null };

// 30 或 29.5:整數就不帶小數,少一點「報表感」
export const fmtP = (v: number) => (Math.round(v * 10) / 10).toString();

// 季中位數序列(n=季內筆數,下結論前先過樣本門檻)
export function quarterMedians(deals: PricePoint[]): { t: number; v: number; n: number }[] {
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const byQ = new Map<string, { t: number; vs: number[] }>();
  for (const d of deals) {
    if (!d.deal_date || d.unit_price == null || d.unit_price <= 0) continue;
    const dt = new Date(d.deal_date), q = Math.floor(dt.getMonth() / 3);
    const key = `${dt.getFullYear()}Q${q + 1}`;
    const mid = +new Date(dt.getFullYear(), q * 3 + 1, 15); // 季中當 x 座標
    (byQ.get(key) ?? byQ.set(key, { t: mid, vs: [] }).get(key)!).vs.push(d.unit_price);
  }
  return [...byQ.values()].map((g) => ({ t: g.t, v: median(g.vs), n: g.vs.length })).sort((a, b) => a.t - b.t);
}

// 逐行重點:一行一件事
export function KeyPoint({ icon, children }: { icon: string; children: ReactNode }) {
  return <div className="kp"><span className="ki">{icon}</span><span>{children}</span></div>;
}

// 近一年走勢的白話句;資料太少(單季 <3 筆)不硬給結論,回 null
export function trendPoint(deals: PricePoint[], subject = "成交價"): ReactNode | null {
  const qs = quarterMedians(deals).filter((q) => q.n >= 3);
  if (qs.length < 2) return null;
  const last = qs[qs.length - 1];
  const base = [...qs].reverse().find((q) => last.t - q.t >= 365 * 86400e3 * 0.7);
  if (!base) return null;
  const pct = (last.v / base.v - 1) * 100;
  if (Math.abs(pct) < 2) return <KeyPoint icon="➖">這一年{subject}<b>差不多</b>,沒什麼漲跌</KeyPoint>;
  return pct > 0
    ? <KeyPoint icon="📈">這一年{subject}<b className="rich">漲了約 {Math.abs(pct).toFixed(0)}%</b></KeyPoint>
    : <KeyPoint icon="📉">這一年{subject}<b className="cheap">跌了約 {Math.abs(pct).toFixed(0)}%</b></KeyPoint>;
}

export function recentPoint(deals: PricePoint[]): ReactNode {
  const cutoff = Date.now() - 90 * 86400e3;
  const n = deals.filter((d) => d.deal_date && +new Date(d.deal_date) >= cutoff).length;
  return n > 0
    ? <KeyPoint icon="🕐">最近 90 天有 <b>{n} 筆</b>成交</KeyPoint>
    : <KeyPoint icon="🕐">最近 90 天<b>沒有</b>新成交</KeyPoint>;
}

// 貴/便宜徽章:把「vs 生活圈同帶中位」翻成人話
export function priceBadge(vsZone: number | null, zoneName: string | null, bandLabel: string | null) {
  if (vsZone == null || !zoneName)
    return <span className="badge none">附近成交太少,暫時無法比較行情</span>;
  const ref = bandLabel === "預售" ? `${zoneName}一帶的預售案`
    : bandLabel && bandLabel !== "全部" ? `${zoneName}一帶同屋齡的房子`
    : `${zoneName}一帶的行情`;
  const v = Math.abs(vsZone);
  if (v < 3) return <span className="badge flat">價格和{ref}差不多</span>;
  return vsZone < 0
    ? <span className="badge cheap">比{ref}便宜約 {v.toFixed(0)}%</span>
    : <span className="badge rich">比{ref}貴約 {v.toFixed(0)}%</span>;
}

// 房型卡:幾房、大概多少錢(總價帶取中間 50% 的成交)
type RoomDeal = { rooms: number | null; total_price: number | null; unit_price: number | null };
const ROOM_GROUPS: { label: string; match: (r: number) => boolean }[] = [
  { label: "1房", match: (r) => r <= 1 },
  { label: "2房", match: (r) => r === 2 },
  { label: "3房", match: (r) => r === 3 },
  { label: "4房+", match: (r) => r >= 4 },
];
export function RoomBreakdown({ deals }: { deals: RoomDeal[] }) {
  const med = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const qt = (xs: number[], q: number) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * q))];
  };
  const rows = ROOM_GROUPS.map((g) => {
    const ds = deals.filter((d) => d.rooms != null && g.match(d.rooms));
    const totals = ds.map((d) => d.total_price).filter((v): v is number => v != null);
    const units = ds.map((d) => d.unit_price).filter((v): v is number => v != null);
    return { label: g.label, n: ds.length, p25: qt(totals, 0.25), p75: qt(totals, 0.75), mu: med(units) };
  }).filter((r) => r.n > 0);
  if (!rows.length) return null;
  return (
    <div className="sec">
      <div className="sechead">幾房、大概多少錢?</div>
      <div className="sechint">多數人成交的總價範圍(去掉特別高和特別低的)</div>
      <div className="roomcards">
        {rows.map((r) => (
          <div className="roomcard" key={r.label}>
            <div className="rlabel">{r.label}</div>
            <div className="rprice num">
              {r.p25 == null || r.p75 == null ? "—"
                : `${Math.round(r.p25).toLocaleString()}~${Math.round(r.p75).toLocaleString()} 萬`}
            </div>
            <div className="rmeta">{r.n} 筆成交{r.mu != null ? `・一坪約 ${fmtP(r.mu)} 萬` : ""}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 成交單價走勢:原始成交打點(淡),季中位數走深色實線;樣本太少只給點
export function TrendChart({ deals }: { deals: PricePoint[] }) {
  const pts = deals
    .filter((d) => d.deal_date && d.unit_price != null && d.unit_price > 0)
    .map((d) => ({ t: +new Date(d.deal_date!), v: d.unit_price!, label: `${d.deal_date}・${d.unit_price!.toFixed(1)} 萬/坪` }))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 3) return null;

  const W = 404, H = 168, L = 34, R = 12, T = 10, B = 20;
  const t0 = pts[0].t, t1 = Math.max(pts[pts.length - 1].t, t0 + 1);
  const vs = pts.map((p) => p.v);
  const vmin = Math.floor(Math.min(...vs) * 0.96), vmax = Math.ceil(Math.max(...vs) * 1.04);
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - vmin) / Math.max(1e-9, vmax - vmin)) * (H - T - B);

  const qs = quarterMedians(deals);
  const yTicks = [vmin, (vmin + vmax) / 2, vmax];
  const years: number[] = [];
  for (let yr = new Date(t0).getFullYear() + 1; yr <= new Date(t1).getFullYear(); yr++)
    years.push(+new Date(yr, 0, 1));
  const last = qs[qs.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img"
      aria-label="成交單價走勢(明細見下表)">
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#edf0f2" />
          <text x={L - 5} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="#8a97a0" className="num">{v.toFixed(0)}</text>
        </g>
      ))}
      {years.map((t) => (
        <text key={t} x={x(t)} y={H - 6} textAnchor="middle" fontSize={10} fill="#8a97a0" className="num">
          {new Date(t).getFullYear()}
        </text>
      ))}
      {pts.map((p, i) => (
        <circle key={i} cx={x(p.t)} cy={y(p.v)} r={3} fill="#7aa7cf" fillOpacity={0.5}>
          <title>{p.label}</title>
        </circle>
      ))}
      {qs.length >= 2 && (
        <polyline points={qs.map((q) => `${x(q.t)},${y(q.v)}`).join(" ")}
          fill="none" stroke="#184a7c" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      )}
      {qs.length >= 2 && qs.map((q, i) => (
        <circle key={i} cx={x(q.t)} cy={y(q.v)} r={3.2} fill="#184a7c" stroke="#fff" strokeWidth={1.5}>
          <title>季中位 {q.v.toFixed(1)} 萬/坪</title>
        </circle>
      ))}
      {qs.length >= 2 && (
        <text x={Math.min(x(last.t) + 6, W - 2)} y={y(last.v) - 7} fontSize={11} fontWeight={700}
          fill="#184a7c" textAnchor="end" className="num">{last.v.toFixed(1)}</text>
      )}
    </svg>
  );
}
