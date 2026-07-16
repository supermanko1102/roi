import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { FeatureCollection } from "geojson";
import { BAND_LABEL, type BandFilter } from "@/lib/age";
import { inGeom } from "@/lib/geo";
import { quarterMedians, TrendChart } from "./BuildingDrawer";

// 建案(預售)抽屜:與中古棟抽屜同殼,但主打預售獨有的資訊——
// 去化進度(棟及號 distinct)、格局總價帶、樓層價差、解約紀錄

type PDeal = {
  deal_date: string | null; total_price: number | null; area_ping: number | null;
  unit_price: number | null; rooms: number | null; baths: number | null;
  floor_no: number | null; total_floors: number | null; unit_id: string | null;
  is_cancelled: boolean | null; cancel_date: string | null;
};
type PDetail = {
  project: {
    name: string; district: string; lat: number | null; lng: number | null;
    unit_price: number | null; median_total: number | null; median_area: number | null;
    deal_count: number | null; cancel_count: number | null;
  };
  community: {
    households: number | null; street: string | null; permit_no: string | null;
    first_reg: string | null; declare_date: string | null; phases: number;
  } | null;
  band: string; build_year: number | null;
  deals: PDeal[];
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
};

// 去化曲線:累積成交(戶)/總戶數;無戶數就畫累積筆數
function SalesCurve({ deals, households }: { deals: PDeal[]; households: number | null }) {
  const pts = useMemo(() => {
    const dated = deals.filter((d) => d.deal_date).sort((a, b) => +new Date(a.deal_date!) - +new Date(b.deal_date!));
    const seen = new Set<string>();
    const out: { t: number; n: number }[] = [];
    let n = 0;
    for (const d of dated) {
      // 同戶重複出現(轉售/更正)只計一次;無棟及號就退回逐筆累積
      const key = d.unit_id ?? `#${out.length}`;
      if (seen.has(key)) continue;
      seen.add(key); n++;
      out.push({ t: +new Date(d.deal_date!), n });
    }
    return out;
  }, [deals]);
  if (pts.length < 3) return null;

  const W = 404, H = 120, L = 34, R = 12, T = 8, B = 18;
  const t0 = pts[0].t, t1 = Math.max(pts[pts.length - 1].t, t0 + 1);
  const yMax = Math.max(households ?? 0, pts[pts.length - 1].n);
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (n: number) => T + (1 - n / Math.max(1, yMax)) * (H - T - B);
  const last = pts[pts.length - 1];
  const pct = households ? (last.n / households) * 100 : null;

  const years: number[] = [];
  for (let yr = new Date(t0).getFullYear() + 1; yr <= new Date(t1).getFullYear(); yr++)
    years.push(+new Date(yr, 0, 1));

  return (
    <div style={{ marginTop: 12 }}>
      <div className="sectitle">
        去化進度{pct != null && <b className="num">{pct.toFixed(0)}%({last.n}/{households} 戶)</b>}
        {pct == null && <b className="num">{last.n} 戶</b>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img"
        aria-label="累積成交戶數曲線">
        {households && [0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(households * f)} y2={y(households * f)}
              stroke="#edf0f2" strokeDasharray={f === 1 ? "0" : "3 3"} />
            <text x={L - 5} y={y(households * f) + 3.5} textAnchor="end" fontSize={10} fill="#8a97a0" className="num">
              {Math.round(households * f)}
            </text>
          </g>
        ))}
        {years.map((t) => (
          <text key={t} x={x(t)} y={H - 4} textAnchor="middle" fontSize={10} fill="#8a97a0" className="num">
            {new Date(t).getFullYear()}
          </text>
        ))}
        <polyline points={pts.map((p) => `${x(p.t)},${y(p.n)}`).join(" ")}
          fill="none" stroke="#16606b" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last.t)} cy={y(last.n)} r={3.2} fill="#16606b" stroke="#fff" strokeWidth={1.5} />
      </svg>
    </div>
  );
}

const ROOM_ROWS: { label: string; match: (r: number) => boolean }[] = [
  { label: "1房", match: (r) => r <= 1 },
  { label: "2房", match: (r) => r === 2 },
  { label: "3房", match: (r) => r === 3 },
  { label: "4房+", match: (r) => r >= 4 },
];
const FLOOR_ROWS: { label: string; match: (f: number) => boolean }[] = [
  { label: "1–5F", match: (f) => f <= 5 },
  { label: "6–10F", match: (f) => f > 5 && f <= 10 },
  { label: "11–15F", match: (f) => f > 10 && f <= 15 },
  { label: "16F+", match: (f) => f > 15 },
];

export default function ProjectDrawer({ district, name, zones, onClose }: {
  district: string; name: string; zones: FeatureCollection | null; onClose: () => void;
}) {
  const [detail, setDetail] = useState<PDetail | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    setDetail(null); setErr(false);
    fetch(`/api/project-detail?district=${encodeURIComponent(district)}&name=${encodeURIComponent(name)}`)
      .then((r) => { if (!r.ok) throw 0; return r.json(); })
      .then(setDetail).catch(() => setErr(true));
  }, [district, name]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const p = detail?.project;
  const active = useMemo(() => (detail?.deals ?? []).filter((d) => !d.is_cancelled), [detail]);
  const cancelled = useMemo(() => (detail?.deals ?? []).filter((d) => d.is_cancelled), [detail]);

  const zone = useMemo(() => {
    if (!zones || !p?.lat || !p?.lng) return null;
    const f: any = zones.features.find((f: any) => inGeom(+p.lng!, +p.lat!, f.geometry));
    return f ? f.properties : null;
  }, [zones, p]);

  // 比較基準:所在生活圈「同屋齡帶」中位(預售案就是預售帶),不足退圈內全部
  const band = (detail?.band ?? "presale") as BandFilter;
  const zoneRef = zone == null ? null
    : (zone[`price_${band}`] != null
        ? { v: +zone[`price_${band}`], label: BAND_LABEL[band] ?? "" }
        : zone.price_all != null ? { v: +zone.price_all, label: "全部" } : null);
  const unit = p?.unit_price ?? null;
  const vsZone = unit && zoneRef ? (unit / zoneRef.v - 1) * 100 : null;

  const households = detail?.community?.households ?? null;

  // 一句話結論:溢價、走勢、去化、解約——預售決策的四個關鍵
  const verdict = useMemo(() => {
    if (!detail) return null;
    const parts: ReactNode[] = [];
    if (vsZone != null && zone) {
      const ref = `${zone.name}同屋齡帶(${zoneRef!.label})行情`;
      parts.push(Math.abs(vsZone) < 3
        ? <span key="p">與{ref}<b>相當</b></span>
        : <span key="p">比{ref}<b className={vsZone < 0 ? "cheap" : "rich"}>
            {vsZone < 0 ? "便宜" : "貴"} {Math.abs(vsZone).toFixed(1)}%</b></span>);
    }
    // 單季樣本 <3 的季不拿來下結論(零星高價戶會做出假漲幅)
    const qs = quarterMedians(active).filter((q) => q.n >= 3);
    if (qs.length >= 2) {
      const last = qs[qs.length - 1];
      const base = [...qs].reverse().find((q) => last.t - q.t >= 365 * 86400e3 * 0.7);
      if (base) {
        const pct = (last.v / base.v - 1) * 100;
        parts.push(Math.abs(pct) < 2
          ? <span key="t">近一年季中位<b>大致持平</b></span>
          : <span key="t">近一年季中位<b className={pct > 0 ? "rich" : "cheap"}>
              {pct > 0 ? "上漲" : "下跌"} {Math.abs(pct).toFixed(1)}%</b></span>);
      }
    }
    const cutoff = Date.now() - 90 * 86400e3;
    const recent = active.filter((d) => d.deal_date && +new Date(d.deal_date) >= cutoff).length;
    parts.push(<span key="r">近 90 天{recent > 0 ? <>成交 <b>{recent} 筆</b></> : "無成交"}</span>);
    if (households) {
      const sold = new Set(active.filter((d) => d.unit_id).map((d) => d.unit_id!)).size || active.length;
      parts.push(<span key="s">已去化約 <b>{Math.min(100, (sold / households) * 100).toFixed(0)}%</b></span>);
    }
    if (cancelled.length) {
      parts.push(<span key="c">曾有 <b className="rich">{cancelled.length} 筆解約</b></span>);
    }
    return parts;
  }, [detail, active, cancelled, vsZone, zone, zoneRef, households]);

  // 格局總價帶:P25–P75 讓使用者知道「這案 3 房大概要準備多少錢」
  const roomRows = useMemo(() => ROOM_ROWS.map((rr) => {
    const ds = active.filter((d) => d.rooms != null && rr.match(d.rooms));
    const totals = ds.map((d) => d.total_price).filter((v): v is number => v != null);
    const units = ds.map((d) => d.unit_price).filter((v): v is number => v != null);
    return { label: rr.label, n: ds.length, p25: quantile(totals, 0.25), p75: quantile(totals, 0.75), mu: median(units) };
  }).filter((r) => r.n > 0), [active]);

  const floorRows = useMemo(() => FLOOR_ROWS.map((fr) => {
    const ds = active.filter((d) => d.floor_no != null && fr.match(d.floor_no));
    const units = ds.map((d) => d.unit_price).filter((v): v is number => v != null);
    return { label: fr.label, n: ds.length, mu: median(units) };
  }).filter((r) => r.n > 0), [active]);

  const recentDeals = useMemo(() =>
    [...active].sort((a, b) => +new Date(b.deal_date ?? 0) - +new Date(a.deal_date ?? 0)), [active]);

  const age = detail?.build_year ? new Date().getFullYear() - detail.build_year : null;

  return (
    <aside className="drawer">
      <button className="dclose" onClick={onClose} aria-label="關閉">✕</button>
      {err && <div className="note">載入失敗,請重試。</div>}
      {!detail && !err && <div className="note">載入中…</div>}
      {detail && p && (
        <>
          <h2>{p.name}</h2>
          <div className="dsub">
            {p.district}
            ・{detail.band === "presale" ? "預售" : age != null ? `${age} 年屋(已完工)` : "已完工"}
            {households ? `・${households} 戶` : ""}
            {detail.community?.street ? `・${detail.community.street}` : ""}
            {detail.community?.permit_no ? `・建照 ${detail.community.permit_no}` : ""}
          </div>

          {verdict && verdict.length > 0 && (
            <div className="verdict">
              {verdict.map((v, i) => <span key={i}>{i > 0 && ";"}{v}</span>)}。
            </div>
          )}

          <div className="statrow">
            <div className="stat">
              <b className="num">{unit == null ? "—" : (+unit).toFixed(1)}</b>
              <span>中位單價(萬/坪,扣車位)</span>
            </div>
            <div className="stat">
              <b className="num">{p.median_total == null ? "—" : Math.round(+p.median_total).toLocaleString()}</b>
              <span>中位總價(萬){p.median_area ? `・${(+p.median_area).toFixed(0)} 坪` : ""}</span>
            </div>
            <div className="stat">
              <b className="num">{vsZone == null ? "—" : (() => { const v = +vsZone.toFixed(1); return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`; })()}</b>
              <span>{zone ? `vs ${zone.name}${zoneRef ? `(${zoneRef.label})` : ""}中位` : "vs 生活圈(圈外)"}</span>
            </div>
          </div>

          <SalesCurve deals={active} households={households} />

          <div className="sectitle" style={{ marginTop: 12 }}>單價走勢</div>
          <TrendChart deals={active} />

          {roomRows.length > 0 && (
            <>
              <div className="sectitle" style={{ marginTop: 12 }}>格局總價帶</div>
              <table className="deals num">
                <thead><tr><th>格局</th><th>筆數</th><th>總價帶(P25–P75)</th><th>中位單價</th></tr></thead>
                <tbody>
                  {roomRows.map((r) => (
                    <tr key={r.label}>
                      <td>{r.label}</td><td>{r.n}</td>
                      <td>{r.p25 == null || r.p75 == null ? "—"
                        : `${Math.round(r.p25).toLocaleString()}–${Math.round(r.p75).toLocaleString()} 萬`}</td>
                      <td>{r.mu == null ? "—" : r.mu.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {floorRows.length >= 2 && (
            <>
              <div className="sectitle" style={{ marginTop: 12 }}>樓層價差</div>
              <table className="deals num">
                <thead><tr><th>樓層</th><th>筆數</th><th>中位單價(萬/坪)</th></tr></thead>
                <tbody>
                  {floorRows.map((r) => (
                    <tr key={r.label}><td>{r.label}</td><td>{r.n}</td><td>{r.mu == null ? "—" : r.mu.toFixed(1)}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {cancelled.length > 0 && (
            <>
              <div className="sectitle" style={{ marginTop: 12, color: "#b02a37" }}>解約紀錄</div>
              <table className="deals num">
                <thead><tr><th>解約日</th><th>原成交日</th><th>樓層</th><th>總價</th><th>單價</th></tr></thead>
                <tbody>
                  {cancelled.map((d, i) => (
                    <tr key={i}>
                      <td>{d.cancel_date ?? "—"}</td>
                      <td>{d.deal_date ?? "—"}</td>
                      <td>{d.floor_no != null ? `${d.floor_no}F` : "—"}</td>
                      <td>{d.total_price == null ? "—" : `${Math.round(d.total_price).toLocaleString()} 萬`}</td>
                      <td>{d.unit_price == null ? "—" : d.unit_price.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="sectitle" style={{ marginTop: 12 }}>成交明細</div>
          <table className="deals num">
            <thead><tr><th>日期</th><th>棟號/樓</th><th>格局</th><th>總價</th><th>單價</th></tr></thead>
            <tbody>
              {recentDeals.slice(0, 120).map((d, i) => (
                <tr key={i}>
                  <td>{d.deal_date ?? "—"}</td>
                  <td className="addr" title={d.unit_id ?? ""}>
                    {d.unit_id ?? (d.floor_no != null ? `${d.floor_no}F` : "—")}
                  </td>
                  <td>{d.rooms != null ? `${d.rooms}房` : "—"}</td>
                  <td>{d.total_price == null ? "—" : `${Math.round(d.total_price).toLocaleString()} 萬`}</td>
                  <td>{d.unit_price == null ? "—" : d.unit_price.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {recentDeals.length > 120 && <div className="note">僅列最近 120 筆(共 {recentDeals.length} 筆)</div>}
          <div className="note">單價皆為扣車位口徑(萬/坪);解約件不計入任何統計。</div>
        </>
      )}
    </aside>
  );
}
