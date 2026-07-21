"use client";
import { useEffect, useMemo, useState } from "react";
import { fmtP } from "./drawer-kit";
import BuildingGrid, { parseStack } from "./BuildingGrid";

type PDeal = {
  deal_date: string | null; total_price: number | null; area_ping: number | null;
  unit_price: number | null; rooms: number | null; baths: number | null;
  floor_no: number | null; total_floors: number | null; unit_id: string | null;
  is_cancelled: boolean | null; cancel_date: string | null;
};

type PDetail = {
  project: {
    name: string; district: string; unit_price: number | null;
    median_total: number | null; median_area: number | null;
  };
  community: {
    households: number | null; street: string | null; permit_no: string | null;
    first_reg: string | null; declare_date: string | null; phases: number;
  } | null;
  band: string;
  build_year: number | null;
  deals: PDeal[];
};

function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="project-fact">
      <span>{label}</span>
      <b className="num">{value == null || value === "" ? "—" : value}</b>
    </div>
  );
}

export default function ProjectDrawer({ district, name, onClose, saved, onToggleSaved }: {
  district: string; name: string; onClose: () => void;
  saved: boolean; onToggleSaved: () => void;
}) {
  const [detail, setDetail] = useState<PDetail | null>(null);
  const [err, setErr] = useState(false);
  const [dealView, setDealView] = useState<"grid" | "list">("grid");

  useEffect(() => {
    setDetail(null); setErr(false); setDealView("grid");
    fetch(`/api/project-detail?district=${encodeURIComponent(district)}&name=${encodeURIComponent(name)}`)
      .then((r) => { if (!r.ok) throw 0; return r.json(); })
      .then(setDetail).catch(() => setErr(true));
  }, [district, name]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const active = useMemo(() => (detail?.deals ?? []).filter((d) => !d.is_cancelled), [detail]);
  const cancelled = useMemo(() => (detail?.deals ?? []).filter((d) => d.is_cancelled), [detail]);
  const recentDeals = useMemo(() => [...active]
    .sort((a, b) => +new Date(b.deal_date ?? 0) - +new Date(a.deal_date ?? 0)), [active]);
  // 可放進「樓層×戶別」矩陣的成交（含解約，解約在格內另標示）
  const gridable = useMemo(() => (detail?.deals ?? [])
    .filter((d) => d.floor_no != null && parseStack(d.unit_id) != null).length >= 3, [detail]);
  const view = gridable ? dealView : "list";

  const p = detail?.project;
  const age = detail?.build_year ? new Date().getFullYear() - detail.build_year : null;
  const presale = detail?.band === "presale";

  return (
    <aside className="drawer compact-drawer" aria-label={`${name}建案資料`}>
      <button className="dclose" onClick={onClose} aria-label="關閉">✕</button>
      {err && <div className="note">載入失敗，請重試。</div>}
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
            {detail.community?.street ? `・${detail.community.street}` : ""}
          </div>

          <div className="drawer-actions">
            <button className={saved ? "saved" : ""} onClick={onToggleSaved} aria-pressed={saved}>
              {saved ? "★ 已加入比較" : "☆ 加入比較"}
            </button>
          </div>

          <div className="hero project-summary">
            <div className="hprice">成交單價中位數<b className="num">{p.unit_price == null ? "—" : fmtP(+p.unit_price)}</b>萬／坪</div>
            <div className="summary-pairs">
              <Fact label="成交總價中位數" value={p.median_total == null ? null : `${Math.round(+p.median_total).toLocaleString()} 萬`} />
              <Fact label="成交坪數中位數" value={p.median_area == null ? null : `${Math.round(+p.median_area)} 坪`} />
            </div>
            <div className="data-freshness">
              {recentDeals[0]?.deal_date ? `最新成交 ${recentDeals[0].deal_date}` : "暫無成交日期"}
              ・{active.length} 筆成交
            </div>
          </div>

          <section className="sec project-data" aria-label="建案基本資料">
            <div className="sechead">基本資料</div>
            <div className="project-facts">
              <Fact label="戶數" value={detail.community?.households ? `${detail.community.households} 戶` : null} />
              <Fact label="建造執照" value={detail.community?.permit_no} />
              <Fact label="首次登記" value={detail.community?.first_reg} />
              <Fact label="申報備查" value={detail.community?.declare_date} />
              <Fact label="成交筆數" value={`${active.length} 筆`} />
              <Fact label="解約筆數" value={`${cancelled.length} 筆`} />
            </div>
          </section>

          <section className="sec">
            <div className="sechead">成交紀錄
              <span className="secval num">{recentDeals.length} 筆</span>
              {gridable && (
                <span className="view-toggle" role="tablist" aria-label="成交紀錄顯示方式">
                  <button role="tab" aria-selected={view === "grid"}
                    className={view === "grid" ? "on" : ""} onClick={() => setDealView("grid")}>棟別圖</button>
                  <button role="tab" aria-selected={view === "list"}
                    className={view === "list" ? "on" : ""} onClick={() => setDealView("list")}>列表</button>
                </span>
              )}
            </div>
            {view === "grid" ? (
              <BuildingGrid deals={detail.deals} />
            ) : (
              <>
                <table className="deals num" style={{ marginTop: 8 }}>
                  <thead><tr><th>日期</th><th>樓層・格局</th><th>總價</th><th>單價</th></tr></thead>
                  <tbody>
                    {recentDeals.slice(0, 40).map((d, i) => (
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
                {recentDeals.length > 40 && <div className="table-note">顯示最近 40 筆</div>}
              </>
            )}
          </section>

          {cancelled.length > 0 && (
            <details className="record-details">
              <summary>解約紀錄（{cancelled.length} 筆）</summary>
              <table className="deals num">
                <thead><tr><th>解約日</th><th>原成交日</th><th>樓層</th><th>總價</th></tr></thead>
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
            </details>
          )}

          <div className="source-note">價格已扣除車位。資料來源：內政部實價登錄。</div>
        </>
      )}
    </aside>
  );
}
