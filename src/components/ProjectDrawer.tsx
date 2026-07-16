import { useEffect, useMemo, useState } from "react";
import type { FeatureCollection } from "geojson";
import { BAND_LABEL, type BandFilter } from "@/lib/age";
import { inGeom, haversineM } from "@/lib/geo";
import { TrendChart, KeyPoint, trendPoint, recentPoint, priceBadge, fmtP, RoomBreakdown } from "./BuildingDrawer";

// 建案(預售)抽屜:與中古棟抽屜同一套資訊設計——
// 白話回答四個問題:多少錢?貴還是便宜?賣得怎麼樣?幾房要準備多少錢?

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

// 銷售進度曲線:累積成交(戶)/總戶數;無戶數就畫累積戶數
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

  const years: number[] = [];
  for (let yr = new Date(t0).getFullYear() + 1; yr <= new Date(t1).getFullYear(); yr++)
    years.push(+new Date(yr, 0, 1));

  return (
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
  );
}

const FLOOR_ROWS: { label: string; match: (f: number) => boolean }[] = [
  { label: "1–5樓", match: (f) => f <= 5 },
  { label: "6–10樓", match: (f) => f > 5 && f <= 10 },
  { label: "11–15樓", match: (f) => f > 10 && f <= 15 },
  { label: "16樓以上", match: (f) => f > 15 },
];

export default function ProjectDrawer({ district, name, zones, stations, onClose }: {
  district: string; name: string; zones: FeatureCollection | null;
  stations: FeatureCollection | null; onClose: () => void;
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

  // 比較基準:所在生活圈「同屋齡帶」行情(預售案就比預售),不足退圈內全部
  const band = (detail?.band ?? "presale") as BandFilter;
  const zoneRef = zone == null ? null
    : (zone[`price_${band}`] != null
        ? { v: +zone[`price_${band}`], label: BAND_LABEL[band] ?? "" }
        : zone.price_all != null ? { v: +zone.price_all, label: "全部" } : null);
  const unit = p?.unit_price ?? null;
  const vsZone = unit && zoneRef ? (unit / zoneRef.v - 1) * 100 : null;

  const households = detail?.community?.households ?? null;

  // 最近車站前兩名(直線距離 ×1.3 當步行路徑,80m/分)
  const nearStations = useMemo(() => {
    if (!stations || !p?.lat || !p?.lng) return [];
    return (stations.features as any[])
      .map((f) => ({
        name: f.properties.name as string, line: f.properties.line as string,
        construction: f.properties.status === "construction",
        m: haversineM(+p.lat!, +p.lng!, f.geometry.coordinates[1], f.geometry.coordinates[0]),
      }))
      .sort((a, b) => a.m - b.m).slice(0, 2);
  }, [stations, p]);

  // 對比附近新古屋(0-5 年中古):中古資料不上地圖,但留著當「值不值得等三年」的基準
  const resaleRef = zone?.price_0_5 != null && unit != null
    ? { v: +zone.price_0_5, diff: (unit / +zone.price_0_5 - 1) * 100 } : null;
  // 已售戶數:棟及號 distinct;沒有棟及號就用筆數
  const sold = useMemo(() => {
    const ids = new Set(active.filter((d) => d.unit_id).map((d) => d.unit_id!));
    return ids.size || active.length;
  }, [active]);
  const soldPct = households ? Math.min(100, (sold / households) * 100) : null;

  const floorRows = useMemo(() => FLOOR_ROWS.map((fr) => {
    const ds = active.filter((d) => d.floor_no != null && fr.match(d.floor_no));
    const units = ds.map((d) => d.unit_price).filter((v): v is number => v != null);
    return { label: fr.label, n: ds.length, mu: median(units) };
  }).filter((r) => r.n > 0), [active]);

  const recentDeals = useMemo(() =>
    [...active].sort((a, b) => +new Date(b.deal_date ?? 0) - +new Date(a.deal_date ?? 0)), [active]);

  const age = detail?.build_year ? new Date().getFullYear() - detail.build_year : null;
  const presale = detail?.band === "presale";

  return (
    <aside className="drawer">
      <button className="dclose" onClick={onClose} aria-label="關閉">✕</button>
      {err && <div className="note">載入失敗,請重試。</div>}
      {!detail && !err && <div className="note">載入中…</div>}
      {detail && p && (
        <>
          <h2>
            <span>{p.name}</span>
            <span className={`chip ${presale ? "presale" : ""}`}>
              {presale ? "預售" : age != null && age <= 1 ? "新成屋" : `${age} 年屋`}
            </span>
          </h2>
          <div className="dsub">
            {p.district}
            {households ? `・共 ${households} 戶` : ""}
            {detail.community?.street ? `・${detail.community.street}` : ""}
          </div>

          <div className="hero">
            <div className="hprice">一坪約<b className="num">{unit == null ? "—" : fmtP(+unit)}</b>萬</div>
            <div className="hsub">
              {p.median_total != null && `一戶大約 ${Math.round(+p.median_total).toLocaleString()} 萬`}
              {p.median_area != null && `・${Math.round(+p.median_area)} 坪左右`}
            </div>
            {priceBadge(vsZone, zone?.name ?? null, zoneRef?.label ?? null)}
          </div>

          <div className="keypoints">
            {soldPct != null
              ? <KeyPoint icon="🏠">{soldPct >= 95 ? <>幾乎<b>賣完了</b></> : <>已賣出約 <b>{soldPct.toFixed(0)}%</b></>}({sold}/{households} 戶)</KeyPoint>
              : <KeyPoint icon="🏠">目前累計 <b>{sold} 戶</b>成交</KeyPoint>}
            {trendPoint(active, "這個案子的價格")}
            {resaleRef && Math.abs(resaleRef.diff) >= 3 && (
              <KeyPoint icon="💡">附近 5 年內中古屋一坪約 {fmtP(resaleRef.v)} 萬,這案
                <b className={resaleRef.diff > 0 ? "rich" : "cheap"}>
                  {resaleRef.diff > 0 ? "貴" : "便宜"}約 {Math.abs(resaleRef.diff).toFixed(0)}%
                </b>
              </KeyPoint>
            )}
            {nearStations.length > 0 && nearStations[0].m <= 2400 && (
              <KeyPoint icon="🚉">
                步行約 {Math.max(1, Math.round(nearStations[0].m * 1.3 / 80))} 分到
                <b>{nearStations[0].name}</b>({nearStations[0].line}{nearStations[0].construction ? ",施工中" : ""})
              </KeyPoint>
            )}
            {recentPoint(active)}
            {cancelled.length > 0 &&
              <KeyPoint icon="⚠️">有 <b className="rich">{cancelled.length} 筆</b>買了之後解約</KeyPoint>}
          </div>

          {nearStations.length > 0 && (
            <div className="sec">
              <div className="sechead">交通</div>
              <div className="sechint">步行時間以直線距離估算,實際路線可能更遠</div>
              {nearStations.map((s) => {
                const walk = Math.max(1, Math.round(s.m * 1.3 / 80));
                return (
                  <div className="kp" key={`${s.line}|${s.name}`} style={{ marginTop: 6 }}>
                    <span className="ki">🚉</span>
                    <span>
                      {s.name}({s.line}{s.construction ? ",施工中" : ""})・
                      {s.m <= 2400 ? `步行約 ${walk} 分` : `約 ${(s.m / 1000).toFixed(1)} 公里`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="sec">
            <div className="sechead">賣得怎麼樣?
              {soldPct != null && <span className="secval num">{sold}/{households} 戶</span>}
            </div>
            <div className="sechint">線越陡代表那段時間賣得越快</div>
            <SalesCurve deals={active} households={households} />
          </div>

          <RoomBreakdown deals={active} />

          <div className="sec">
            <div className="sechead">價格走勢</div>
            <div className="sechint">每個淡點是一筆實際成交,深色線是每一季的行情</div>
            <TrendChart deals={active} />
          </div>

          {floorRows.length >= 2 && (
            <div className="sec">
              <div className="sechead">樓層與價格</div>
              <table className="deals num" style={{ marginTop: 6 }}>
                <thead><tr><th>樓層</th><th>一坪約</th><th>成交筆數</th></tr></thead>
                <tbody>
                  {floorRows.map((r) => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td>{r.mu == null ? "—" : `${fmtP(r.mu)} 萬`}</td>
                      <td>{r.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {cancelled.length > 0 && (
            <div className="sec">
              <div className="sechead" style={{ color: "#b02a37" }}>解約紀錄</div>
              <div className="sechint">這些戶買了之後解約,沒有算進上面的價格與銷售統計</div>
              <table className="deals num" style={{ marginTop: 6 }}>
                <thead><tr><th>解約日</th><th>原本買的日期</th><th>樓層</th><th>總價</th></tr></thead>
                <tbody>
                  {cancelled.map((d, i) => (
                    <tr key={i}>
                      <td>{d.cancel_date ?? "—"}</td>
                      <td>{d.deal_date ?? "—"}</td>
                      <td>{d.floor_no != null ? `${d.floor_no}樓` : "—"}</td>
                      <td>{d.total_price == null ? "—" : `${Math.round(d.total_price).toLocaleString()} 萬`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="sec">
            <div className="sechead">成交紀錄
              <span className="secval num">{recentDeals.length} 筆</span>
            </div>
            <table className="deals num" style={{ marginTop: 6 }}>
              <thead><tr><th>日期</th><th>樓層・格局</th><th>總價</th><th>一坪</th></tr></thead>
              <tbody>
                {recentDeals.slice(0, 120).map((d, i) => (
                  <tr key={i}>
                    <td>{d.deal_date ?? "—"}</td>
                    <td title={d.unit_id ?? ""}>
                      {[d.floor_no != null ? `${d.floor_no}樓` : null, d.rooms != null ? `${d.rooms}房` : null]
                        .filter(Boolean).join("・") || (d.unit_id ?? "—")}
                    </td>
                    <td>{d.total_price == null ? "—" : `${Math.round(d.total_price).toLocaleString()} 萬`}</td>
                    <td>{d.unit_price == null ? "—" : `${fmtP(d.unit_price)} 萬`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {recentDeals.length > 120 && <div className="note">僅列最近 120 筆</div>}
          </div>

          <div className="note" style={{ marginTop: 14 }}>
            所有價格都已扣掉車位。
            {zone && zoneRef ? `「附近行情」指 ${zone.name} 生活圈${zoneRef.label === "預售" ? "預售案" : zoneRef.label !== "全部" ? `同屋齡(${zoneRef.label})` : ""}的成交行情(一坪約 ${fmtP(zoneRef.v)} 萬)。` : ""}
            資料來源:內政部實價登錄。
          </div>
        </>
      )}
    </aside>
  );
}
