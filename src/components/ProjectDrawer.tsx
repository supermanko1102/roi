"use client";
import { useEffect, useMemo, useState } from "react";
import { fmtP } from "./drawer-kit";
import BuildingGrid, { parseStack } from "./BuildingGrid";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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

const dealsTh = "border-b border-line px-1.5 py-[5px] text-left text-[9.5px] font-bold text-ink-soft";

function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-[#e4e8e5] bg-white p-2.5">
      <span className="mb-1 block text-[9px] text-ink-soft">{label}</span>
      <b className="num block text-[11px] font-bold [overflow-wrap:anywhere]">{value == null || value === "" ? "—" : value}</b>
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
    <aside className="absolute inset-y-0 right-0 z-[55] w-[min(480px,100%)] animate-drawer-in overflow-y-auto bg-surface px-6 pb-8 pt-6 shadow-[-12px_0_50px_rgba(18,47,40,.18)] max-mob:top-auto max-mob:h-[min(84%,760px)] max-mob:w-full max-mob:animate-drawer-up max-mob:rounded-t-[20px] max-mob:px-[18px] max-mob:pb-[88px] max-mob:pt-[25px] max-mob:before:absolute max-mob:before:left-1/2 max-mob:before:top-2 max-mob:before:h-1 max-mob:before:w-[42px] max-mob:before:-translate-x-1/2 max-mob:before:rounded-full max-mob:before:bg-[#ced6d2] max-mob:before:content-[''] max-tiny:px-[15px]"
      aria-label={`${name}建案資料`}>
      <Button variant="ghost" size="icon-sm" className="absolute right-4 top-4 size-[31px] rounded-full bg-muted text-muted-foreground"
        onClick={onClose} aria-label="關閉">✕</Button>
      {err && <div className="py-[50px] text-center text-xs text-ink-soft">載入失敗，請重試。</div>}
      {!detail && !err && <div className="py-[50px] text-center text-xs text-ink-soft">載入中…</div>}
      {detail && p && (
        <>
          <h2 className="my-0.5 mr-[34px] flex flex-wrap items-center gap-[7px] font-display text-[22px] font-bold leading-[1.25] max-mob:text-xl">
            <span>{p.name}</span>
            <Badge className={cn(
              "h-auto flex-none rounded-full border-0 bg-[#e7f0ed] px-[9px] py-[3px] font-sans text-[10px] font-extrabold leading-[1.4] text-teal",
              presale && "bg-teal text-white",
            )}>
              {presale ? "預售" : age != null && age <= 1 ? "新成屋" : `${age} 年屋`}
            </Badge>
          </h2>
          <div className="mb-[13px] mt-[5px] text-[11px] leading-[1.6] text-ink-soft">
            {p.district}
            {detail.community?.street ? `・${detail.community.street}` : ""}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" aria-pressed={saved} onClick={onToggleSaved}
              className="h-auto min-h-[34px] rounded-[9px] border-[#dec999] bg-[#fffaf0] px-[11px] py-[7px] text-[11px] font-extrabold text-[#83601e] hover:bg-[#fffaf0] aria-pressed:bg-[#a87520] aria-pressed:text-white aria-pressed:hover:bg-[#a87520]">
              {saved ? "★ 已加入比較" : "☆ 加入比較"}
            </Button>
          </div>

          <div className="mb-[11px] rounded-[14px] border border-[#e4e8e5] bg-[#f4f6f3] p-4">
            <div className="text-xs text-ink-soft">成交單價中位數<b className="num mx-[3px] text-[31px] tracking-[-.04em] text-ink">{p.unit_price == null ? "—" : fmtP(+p.unit_price)}</b>萬／坪</div>
            <div className="mt-[13px] grid grid-cols-2 gap-2">
              <Fact label="成交總價中位數" value={p.median_total == null ? null : `${Math.round(+p.median_total).toLocaleString()} 萬`} />
              <Fact label="成交坪數中位數" value={p.median_area == null ? null : `${Math.round(+p.median_area)} 坪`} />
            </div>
            <div className="mt-2 text-[9.5px] text-[#78857f]">
              {recentDeals[0]?.deal_date ? `最新成交 ${recentDeals[0].deal_date}` : "暫無成交日期"}
              ・{active.length} 筆成交
            </div>
          </div>

          <section className="mt-[21px]" aria-label="建案基本資料">
            <div className="flex items-baseline justify-between text-[13.5px] font-extrabold">基本資料</div>
            <div className="mt-[9px] grid grid-cols-2 gap-2">
              <Fact label="戶數" value={detail.community?.households ? `${detail.community.households} 戶` : null} />
              <Fact label="建造執照" value={detail.community?.permit_no} />
              <Fact label="首次登記" value={detail.community?.first_reg} />
              <Fact label="申報備查" value={detail.community?.declare_date} />
              <Fact label="成交筆數" value={`${active.length} 筆`} />
              <Fact label="解約筆數" value={`${cancelled.length} 筆`} />
            </div>
          </section>

          <section className="mt-[21px]">
            <div className={cn("flex items-baseline text-[13.5px] font-extrabold", gridable ? "gap-2.5" : "justify-between")}>成交紀錄
              <span className="num text-[12.5px] text-teal">{recentDeals.length} 筆</span>
              {gridable && (
                <span className="ml-auto inline-flex overflow-hidden rounded-full border border-line" role="tablist" aria-label="成交紀錄顯示方式">
                  <button role="tab" aria-selected={view === "grid"}
                    className="border-0 bg-white px-[11px] py-1 text-[10.5px] font-extrabold text-ink-soft aria-selected:bg-teal aria-selected:text-white"
                    onClick={() => setDealView("grid")}>棟別圖</button>
                  <button role="tab" aria-selected={view === "list"}
                    className="border-0 bg-white px-[11px] py-1 text-[10.5px] font-extrabold text-ink-soft aria-selected:bg-teal aria-selected:text-white"
                    onClick={() => setDealView("list")}>列表</button>
                </span>
              )}
            </div>
            {view === "grid" ? (
              <BuildingGrid deals={detail.deals} />
            ) : (
              <>
                <table className="num mt-2 w-full border-collapse text-[11px]">
                  <thead><tr><th className={dealsTh}>日期</th><th className={dealsTh}>樓層・格局</th><th className={dealsTh}>總價</th><th className={dealsTh}>單價</th></tr></thead>
                  <tbody>
                    {recentDeals.slice(0, 40).map((d, i) => (
                      <tr key={i} className="even:bg-[#f5f7f4]">
                        <td className="p-1.5">{d.deal_date ?? "—"}</td>
                        <td className="p-1.5" title={d.unit_id ?? ""}>
                          {[d.floor_no != null ? `${d.floor_no}樓` : null, d.rooms != null ? `${d.rooms}房` : null]
                            .filter(Boolean).join("・") || (d.unit_id ?? "—")}
                        </td>
                        <td className="p-1.5">{d.total_price == null ? "—" : `${Math.round(d.total_price).toLocaleString()} 萬`}</td>
                        <td className="p-1.5">{d.unit_price == null ? "—" : `${fmtP(d.unit_price)} 萬`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {recentDeals.length > 40 && <div className="mt-[7px] text-right text-[9px] text-ink-soft">顯示最近 40 筆</div>}
              </>
            )}
          </section>

          {cancelled.length > 0 && (
            <details className="mt-[18px] border-t border-line">
              <summary className="py-3 text-[11px] font-extrabold text-teal">解約紀錄（{cancelled.length} 筆）</summary>
              <table className="num w-full border-collapse text-[11px]">
                <thead><tr><th className={dealsTh}>解約日</th><th className={dealsTh}>原成交日</th><th className={dealsTh}>樓層</th><th className={dealsTh}>總價</th></tr></thead>
                <tbody>
                  {cancelled.map((d, i) => (
                    <tr key={i} className="even:bg-[#f5f7f4]">
                      <td className="p-1.5">{d.cancel_date ?? "—"}</td>
                      <td className="p-1.5">{d.deal_date ?? "—"}</td>
                      <td className="p-1.5">{d.floor_no != null ? `${d.floor_no}樓` : "—"}</td>
                      <td className="p-1.5">{d.total_price == null ? "—" : `${Math.round(d.total_price).toLocaleString()} 萬`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          <div className="mt-[18px] border-t border-line pt-[11px] text-[9px] leading-[1.5] text-ink-soft">價格已扣除車位。資料來源：內政部實價登錄。</div>
        </>
      )}
    </aside>
  );
}
