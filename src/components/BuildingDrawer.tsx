import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { FeatureCollection } from "geojson";
import { ageBand, BAND_LABEL, type BandFilter } from "@/lib/age";
import { inGeom } from "@/lib/geo";

// 樂居式詳情,但走 Zillow 路線:側邊抽屜蓋在地圖上,不跳頁,地圖照常互動

type Deal = {
  addr_key: string | null; deal_date: string | null;
  total_price: number | null; area_ping: number | null;
  parking_area_ping: number | null; unit_price: number | null;
  rooms: number | null; baths: number | null; floor_no: number | null;
};
type Detail = {
  building: {
    addr_key: string; district: string; lat: number | null; lng: number | null;
    deal_count: number | null; median_unit_price: number | null; median_total: number | null;
    building_type: string | null; build_year: number | null;
  };
  community: { name: string; households: number | null; first_reg: string | null; building_count: number } | null;
  deals: Deal[];
};

// 點在多邊形內:找出所在生活圈,拿圈內中位當比較基準

// 季中位數序列:走勢圖與一句話結論共用的口徑
function quarterMedians(deals: Deal[]): { t: number; v: number }[] {
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
  return [...byQ.values()].map((g) => ({ t: g.t, v: median(g.vs) })).sort((a, b) => a.t - b.t);
}

// 一句話結論:替使用者讀完數據,只給判讀所需的那句話
function Verdict({ deals, vsZone, zoneName, bandLabel }: {
  deals: Deal[]; vsZone: number | null; zoneName: string | null; bandLabel: string | null;
}) {
  const parts: ReactNode[] = [];

  if (vsZone != null && zoneName) {
    const ref = `${zoneName}${bandLabel ? `同屋齡帶(${bandLabel})` : ""}行情`;
    parts.push(Math.abs(vsZone) < 3
      ? <span key="p">與{ref}<b>相當</b></span>
      : <span key="p">比{ref}<b className={vsZone < 0 ? "cheap" : "rich"}>
          {vsZone < 0 ? "便宜" : "貴"} {Math.abs(vsZone).toFixed(1)}%</b></span>);
  }

  // 近一年走勢:最新季中位 vs 約一年前的季中位;資料跨度太短不硬給結論
  const qs = quarterMedians(deals);
  if (qs.length >= 2) {
    const last = qs[qs.length - 1];
    const YEAR = 365 * 86400e3;
    const base = [...qs].reverse().find((q) => last.t - q.t >= YEAR * 0.7);
    if (base) {
      const pct = (last.v / base.v - 1) * 100;
      parts.push(Math.abs(pct) < 2
        ? <span key="t">近一年季中位<b>大致持平</b></span>
        : <span key="t">近一年季中位<b className={pct > 0 ? "rich" : "cheap"}>
            {pct > 0 ? "上漲" : "下跌"} {Math.abs(pct).toFixed(1)}%</b></span>);
    }
  }

  const cutoff = Date.now() - 90 * 86400e3;
  const recent = deals.filter((d) => d.deal_date && +new Date(d.deal_date) >= cutoff).length;
  parts.push(<span key="r">近 90 天{recent > 0 ? <>成交 <b>{recent} 筆</b></> : "無成交"}</span>);

  if (!parts.length) return null;
  return (
    <div className="verdict">
      {parts.map((p, i) => <span key={i}>{i > 0 && ";"}{p}</span>)}。
    </div>
  );
}

// 成交單價走勢:原始成交打點(淡),季中位數走深色實線;樣本太少只給點
function TrendChart({ deals }: { deals: Deal[] }) {
  const pts = useMemo(() => deals
    .filter((d) => d.deal_date && d.unit_price != null && d.unit_price > 0)
    .map((d) => ({ t: +new Date(d.deal_date!), v: d.unit_price!, label: `${d.deal_date}・${d.unit_price!.toFixed(1)} 萬/坪` }))
    .sort((a, b) => a.t - b.t), [deals]);
  if (pts.length < 3) return null;

  const W = 404, H = 168, L = 34, R = 12, T = 10, B = 20;
  const t0 = pts[0].t, t1 = Math.max(pts[pts.length - 1].t, t0 + 1);
  const vs = pts.map((p) => p.v);
  const vmin = Math.floor(Math.min(...vs) * 0.96), vmax = Math.ceil(Math.max(...vs) * 1.04);
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - vmin) / Math.max(1e-9, vmax - vmin)) * (H - T - B);

  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const byQ = new Map<string, { t: number; vs: number[] }>();
  for (const p of pts) {
    const d = new Date(p.t), q = Math.floor(d.getMonth() / 3);
    const key = `${d.getFullYear()}Q${q + 1}`;
    const mid = +new Date(d.getFullYear(), q * 3 + 1, 15); // 季中當 x 座標
    (byQ.get(key) ?? byQ.set(key, { t: mid, vs: [] }).get(key)!).vs.push(p.v);
  }
  const qs = [...byQ.values()].map((g) => ({ t: g.t, v: median(g.vs) })).sort((a, b) => a.t - b.t);

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

export default function BuildingDrawer({ addrKey, zones, onClose }: {
  addrKey: string; zones: FeatureCollection | null; onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    setDetail(null); setErr(false);
    fetch(`/api/building-detail?addr=${encodeURIComponent(addrKey)}`)
      .then((r) => { if (!r.ok) throw 0; return r.json(); })
      .then(setDetail).catch(() => setErr(true));
  }, [addrKey]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const b = detail?.building;
  const zone = useMemo(() => {
    if (!zones || !b?.lat || !b?.lng) return null;
    const f: any = zones.features.find((f: any) => inGeom(+b.lng!, +b.lat!, f.geometry));
    return f ? f.properties : null;
  }, [zones, b]);

  const unit = b?.median_unit_price ?? null;
  // 比較基準:所在生活圈「同屋齡帶」中位;帶內樣本不足(null)退回圈內全部
  const band = ageBand(b?.build_year ?? null);
  const zoneRef = zone == null ? null
    : (band !== "unknown" && zone[`price_${band}`] != null
        ? { v: +zone[`price_${band}`], label: BAND_LABEL[band as BandFilter] }
        : zone.price_all != null ? { v: +zone.price_all, label: "全部" } : null);
  const vsZone = unit && zoneRef ? (unit / zoneRef.v - 1) * 100 : null;
  const age = b?.build_year ? new Date().getFullYear() - b.build_year : null;
  const shortAddr = (s: string) => s.replace(/^桃園市[^區]+區/, "");

  return (
    <aside className="drawer">
      <button className="dclose" onClick={onClose} aria-label="關閉">✕</button>
      {err && <div className="note">載入失敗,請重試。</div>}
      {!detail && !err && <div className="note">載入中…</div>}
      {detail && b && (
        <>
          <h2>{detail.community?.name ?? shortAddr(b.addr_key)}</h2>
          <div className="dsub">
            {detail.community && `${shortAddr(b.addr_key)}・`}
            {b.building_type ?? "—"}
            {b.build_year ? `・${new Date().getFullYear() - b.build_year} 年屋` : ""}
            {detail.community?.households ? `・${detail.community.households} 戶` : ""}
            {detail.community && detail.community.building_count > 1 ? `・${detail.community.building_count} 個門牌` : ""}
          </div>

          <Verdict deals={detail.deals} vsZone={vsZone}
            zoneName={zone?.name ?? null} bandLabel={zoneRef?.label ?? null} />

          <div className="statrow">
            <div className="stat">
              <b className="num">{unit == null ? "—" : unit.toFixed(1)}</b>
              <span>中位單價(萬/坪)</span>
            </div>
            <div className="stat">
              <b className="num">{age == null ? "—" : `${age} 年`}</b>
              <span>屋齡{b.build_year ? `(${b.build_year} 完工)` : ""}</span>
            </div>
            <div className="stat">
              {/* 先取一位小數再判斷正負,避免 -0.04 顯示成「-0.0%」 */}
              <b className="num">{vsZone == null ? "—" : (() => { const v = +vsZone.toFixed(1); return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`; })()}</b>
              <span>{zone ? `vs ${zone.name}${zoneRef ? `(${zoneRef.label})` : ""}中位` : "vs 生活圈(圈外)"}</span>
            </div>
          </div>

          <TrendChart deals={detail.deals} />
          <div className="note" style={{ marginTop: 2 }}>
            {detail.community ? "全社區" : "本門牌"}成交 {detail.deals.length} 筆・淡點=單筆成交、深線=季中位
            {zone && zoneRef ? `・所在生活圈:${zone.name}(${zoneRef.label}中位 $${zoneRef.v.toFixed(1)})` : ""}
          </div>

          <table className="deals num" style={{ marginTop: 10 }}>
            <thead><tr><th>日期</th><th>門牌</th><th>格局/樓</th><th>總價</th><th>單價</th></tr></thead>
            <tbody>
              {detail.deals.slice(0, 120).map((d, i) => (
                <tr key={i}>
                  <td>{d.deal_date ?? "—"}</td>
                  <td className="addr" title={d.addr_key ?? ""}>{d.addr_key ? shortAddr(d.addr_key) : "—"}</td>
                  <td>{[d.rooms != null ? `${d.rooms}房` : null, d.floor_no != null ? `${d.floor_no}F` : null]
                        .filter(Boolean).join("/") || "—"}</td>
                  <td>{d.total_price == null ? "—" : `${Math.round(d.total_price).toLocaleString()} 萬`}</td>
                  <td>{d.unit_price == null ? "—" : d.unit_price.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.deals.length > 120 && <div className="note">僅列最近 120 筆(共 {detail.deals.length} 筆)</div>}
          <div className="note">單價皆為扣車位口徑(萬/坪)。</div>
        </>
      )}
    </aside>
  );
}
