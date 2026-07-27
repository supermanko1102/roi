"use client";
import { useEffect, useMemo, useState } from "react";
import { dealsTh, Fact, fmtP, LeaseTable, median, shortRocDate, type RLease } from "./drawer-kit";
import BuildingGrid, { parseStack } from "./BuildingGrid";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CITIES, cityDisplay } from "@/lib/cities";
import { getParkingInfo } from "@/lib/deal-parking";

type PDeal = {
  deal_date: string | null; total_price: number | null; area_ping: number | null;
  unit_price: number | null; rooms: number | null; baths: number | null;
  parking_count: number | null; parking_type: string | null;
  parking_price: number | null; parking_area_ping: number | null;
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
    first_reg: string | null; declare_date: string | null;
    use_issue_date: string | null; phases: number;
  } | null;
  band: string;
  build_year: number | null;
  deals: PDeal[];
  resales: Resale[];
  unit_doors?: UnitDoor[];
  rents?: RLease[];
  materials: { sections: { title: string; body: string }[]; pdf_url: string | null } | null;
};

type Resale = {
  deal_date: string | null; floor_no: number | null; rooms: number | null; baths: number | null;
  total_price: number | null; unit_price: number | null; area_ping: number | null;
  parking_count: number | null; parking_type: string | null;
  parking_price: number | null; parking_area_ping: number | null;
  addr: string | null; is_store: boolean;
};

type UnitDoor = { unit_id: string | null; addr: string | null; n: number };

function unitLabel(unitId: string | null): string {
  const parsed = parseStack(unitId);
  if (!parsed) return unitId || "戶別未登錄";
  return [parsed.building || null, parsed.stack ? `${parsed.stack}戶` : null]
    .filter(Boolean).join("・") || unitId || "戶別未登錄";
}

function ListParking({ deal }: { deal: PDeal }) {
  const parking = getParkingInfo(deal);
  if (parking.included) {
    return (
      <span className="block">
        <b className="inline-block rounded-full bg-[#f4e4c5] px-1.5 py-0.5 text-[8.5px] text-[#785415]">
          {parking.count != null ? `${parking.count} 車位` : "含車位"}
        </b>
        <small className="mt-1 block whitespace-nowrap text-[8.5px] leading-tight text-ink-soft max-mob:whitespace-normal">
          {[parking.type, parking.price > 0 ? `${fmtP(parking.price)} 萬` : "價格未拆"]
            .filter(Boolean).join("・")}
        </small>
      </span>
    );
  }
  if (parking.known) {
    return (
      <span className="inline-block rounded-full bg-[#e9edeb] px-1.5 py-0.5 text-[8.5px] font-bold text-ink-soft">
        無車位
      </span>
    );
  }
  return (
    <span className="inline-block rounded-full border border-dashed border-[#b8c2bd] px-1.5 py-0.5 text-[8.5px] font-bold text-ink-soft">
      未登錄
    </span>
  );
}

// 建材與設備:契約附件六抽出的分節,預設收合,展開後每節可再展開看細目
function MaterialsSection({ sections, pdfUrl }: {
  sections: { title: string; body: string }[]; pdfUrl: string | null;
}) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="mt-[21px] border-t border-line pt-3.5">
      <div className="flex items-baseline gap-2.5 text-[13.5px] font-extrabold">建材與設備
        <span className="num text-[12.5px] text-teal">{sections.length} 項</span>
      </div>
      <div className="mt-2 overflow-hidden rounded-[10px] border border-line">
        {sections.map((s, i) => (
          <div key={i} className="border-t border-line first:border-t-0">
            <button
              className="flex w-full items-center justify-between gap-2 bg-white px-3 py-2 text-left text-[11.5px] font-bold text-ink hover:bg-[#f5f7f4]"
              aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
              {s.title}
              <span className={cn("text-ink-soft transition-transform", open === i && "rotate-90")}>›</span>
            </button>
            {open === i && (
              <div className="whitespace-pre-line bg-[#fbfcfb] px-3 py-2.5 text-[10.5px] leading-relaxed text-ink-soft">
                {s.body}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 text-[9px] leading-normal text-ink-soft">
        摘自預售定型化契約備查之「建材設備表」。
        {pdfUrl && (
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="ml-1 font-bold text-teal underline">
            看官方契約全文 PDF
          </a>
        )}
      </div>
    </section>
  );
}

export default function ProjectDrawer({ city, district, name, onClose, saved, onToggleSaved }: {
  city: string; district: string; name: string; onClose: () => void;
  saved: boolean; onToggleSaved: () => void;
}) {
  const [detail, setDetail] = useState<PDetail | null>(null);
  const [err, setErr] = useState(false);
  const [dealView, setDealView] = useState<"grid" | "list">("grid");

  useEffect(() => {
    setDetail(null); setErr(false); setDealView("grid");
    fetch(`/api/project-detail?city=${encodeURIComponent(city)}&district=${encodeURIComponent(district)}&name=${encodeURIComponent(name)}`)
      .then((r) => { if (!r.ok) throw 0; return r.json(); })
      .then(setDetail).catch(() => setErr(true));
  }, [city, district, name]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const active = useMemo(() => (detail?.deals ?? []).filter((d) => !d.is_cancelled), [detail]);
  const cancelled = useMemo(() => (detail?.deals ?? []).filter((d) => d.is_cancelled), [detail]);
  // 可放進「樓層×戶別」矩陣的成交（含解約，解約在格內另標示）
  const gridable = useMemo(() => (detail?.deals ?? [])
    .filter((d) => d.floor_no != null && parseStack(d.unit_id) != null).length >= 3, [detail]);
  const view = gridable ? dealView : "list";

  const p = detail?.project;
  const age = detail?.build_year ? new Date().getFullYear() - detail.build_year : null;
  const presale = detail?.band === "presale";

  // 交屋後轉售 vs 預售的價差(單價中位對單價中位)。
  // 店面單價遠高於住宅,拆開計算避免拉高住宅轉售中位。
  const resales = detail?.resales ?? [];
  const homeResales = useMemo(() => resales.filter((r) => r.is_store !== true), [resales]);
  const storeResales = useMemo(() => resales.filter((r) => r.is_store === true), [resales]);
  const resaleMedian = useMemo(
    () => median(homeResales.map((r) => r.unit_price).filter((v): v is number => v != null).map(Number)),
    [homeResales]);
  const storeMedian = useMemo(
    () => median(storeResales.map((r) => r.unit_price).filter((v): v is number => v != null).map(Number)),
    [storeResales]);
  const premium = resaleMedian != null && p?.unit_price != null && +p.unit_price > 0
    ? ((resaleMedian - +p.unit_price) / +p.unit_price) * 100 : null;

  // 列表 view:預售與交屋後轉售合併成同一條時間軸(轉售掛標記,時間延續到最新一筆)
  const listRows = useMemo(() => [
    ...active.map((d) => ({ ...d, is_resale: false, addr: null as string | null, is_store: false })),
    ...resales.map((r) => ({
      ...r, unit_id: null, total_floors: null, is_cancelled: false, cancel_date: null, is_resale: true,
    })),
  ].sort((a, b) => +new Date(b.deal_date ?? 0) - +new Date(a.deal_date ?? 0)), [active, resales]);

  // 本社區出租行情(排除社宅包租代管,以免拉低市場價;社宅件在租約區塊折疊另列)
  const marketRents = useMemo(
    () => (detail?.rents ?? []).filter((r) => r.is_social !== true),
    [detail]);
  const socialRents = useMemo(
    () => (detail?.rents ?? []).filter((r) => r.is_social === true),
    [detail]);
  const rentMedian = useMemo(
    () => median(marketRents.map((r) => r.rent_per_ping).filter((v): v is number => v != null).map(Number)),
    [marketRents]);
  const rentMonthlyMedian = useMemo(
    () => median(marketRents.map((r) => r.monthly_rent).filter((v): v is number => v != null).map(Number)),
    [marketRents]);

  return (
    <aside className="absolute inset-y-0 right-0 z-55 w-[min(480px,100%)] animate-drawer-in overflow-y-auto bg-surface px-6 pb-8 pt-6 shadow-[-12px_0_50px_rgba(18,47,40,.18)] max-mob:top-auto max-mob:h-[min(84%,760px)] max-mob:w-full max-mob:animate-drawer-up max-mob:rounded-t-[20px] max-mob:px-[18px] max-mob:pb-[88px] max-mob:pt-[25px] max-mob:before:absolute max-mob:before:left-1/2 max-mob:before:top-2 max-mob:before:h-1 max-mob:before:w-[42px] max-mob:before:-translate-x-1/2 max-mob:before:rounded-full max-mob:before:bg-[#ced6d2] max-mob:before:content-[''] max-tiny:px-[15px]"
      aria-label={`${name}建案資料`}>
      <Button variant="ghost" size="icon-sm" className="absolute right-4 top-4 size-[31px] rounded-full bg-muted text-muted-foreground"
        onClick={onClose} aria-label="關閉">✕</Button>
      {err && <div className="py-[50px] text-center text-xs text-ink-soft">載入失敗，請重試。</div>}
      {!detail && !err && <div className="py-[50px] text-center text-xs text-ink-soft">載入中…</div>}
      {detail && p && (
        <>
          <h2 className="my-0.5 mr-[34px] flex flex-wrap items-center gap-[7px] font-display text-[22px] font-bold leading-tight max-mob:text-xl">
            <span>{p.name}</span>
            <Badge className={cn(
              "h-auto flex-none rounded-full border-0 bg-[#e7f0ed] px-[9px] py-[3px] font-sans text-[10px] font-extrabold leading-[1.4] text-teal",
              presale && "bg-teal text-white",
            )}>
              {presale ? "預售" : age != null && age <= 1 ? "新成屋" : `${age} 年屋`}
            </Badge>
          </h2>
          <div className="mb-[13px] mt-[5px] text-[11px] leading-[1.6] text-ink-soft">
            {CITIES.length > 1 ? cityDisplay(city) : ""}{p.district}
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
              {listRows[0]?.deal_date
                ? `${listRows[0].is_resale ? "最新轉售" : "最新成交"} ${listRows[0].deal_date}`
                : "暫無成交日期"}
              ・{active.length} 筆成交
            </div>
            {resaleMedian != null && (
              <div className="mt-2.5 flex flex-wrap items-baseline gap-x-1.5 rounded-[9px] border border-[#d8e4de] bg-white px-2.5 py-2 text-[10.5px] text-ink-soft">
                交屋後轉售中位
                <b className="num text-[15px] tracking-[-.02em] text-ink">{fmtP(resaleMedian)}</b>萬／坪
                {premium != null && (
                  <b className={cn("num text-[11px]", premium >= 0 ? "text-[#9c4038]" : "text-teal")}>
                    （較預售 {premium >= 0 ? "+" : ""}{premium.toFixed(1)}%）
                  </b>
                )}
                <span className="num text-[9.5px]">{homeResales.length} 筆</span>
              </div>
            )}
            {storeMedian != null && (
              <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5 rounded-[9px] border border-[#ecdec2] bg-white px-2.5 py-2 text-[10.5px] text-ink-soft">
                店面轉售中位
                <b className="num text-[15px] tracking-[-.02em] text-ink">{fmtP(storeMedian)}</b>萬／坪
                <span className="num text-[9.5px]">{storeResales.length} 筆・不計入住宅中位</span>
              </div>
            )}
            {rentMedian != null && (
              <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5 rounded-[9px] border border-[#d8e4de] bg-white px-2.5 py-2 text-[10.5px] text-ink-soft">
                本社區出租中位
                <b className="num text-[15px] tracking-[-.02em] text-ink">{Math.round(rentMedian).toLocaleString()}</b>元／坪
                {rentMonthlyMedian != null && (
                  <span>月租中位 <b className="num text-[11px] text-ink">{Math.round(rentMonthlyMedian).toLocaleString()}</b> 元</span>
                )}
                <span className="num text-[9.5px]">{marketRents.length} 筆</span>
              </div>
            )}
          </div>

          <section className="mt-[21px]" aria-label="建案基本資料">
            <div className="flex items-baseline justify-between text-[13.5px] font-extrabold">基本資料</div>
            <div className="mt-[9px] grid grid-cols-2 gap-2">
              <Fact label="戶數" value={detail.community?.households ? `${detail.community.households} 戶` : null} />
              <Fact label="建造執照" value={detail.community?.permit_no} />
              {detail.community?.use_issue_date
                ? <Fact label="使照發照" value={detail.community.use_issue_date} />
                : <Fact label="首次登記" value={detail.community?.first_reg} />}
              <Fact label="申報備查" value={detail.community?.declare_date} />
              <Fact label="成交筆數" value={`${active.length} 筆`} />
              <Fact label="解約筆數" value={`${cancelled.length} 筆`} />
            </div>
          </section>

          <section className="mt-[21px]">
            <div className={cn("flex items-baseline text-[13.5px] font-extrabold", gridable ? "gap-2.5" : "justify-between")}>成交紀錄
              <span className="num text-[12.5px] text-teal">{listRows.length} 筆</span>
              {resales.length > 0 && (
                <span className="num text-[9.5px] font-bold text-ink-soft">含轉售 {resales.length} 筆</span>
              )}
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
              <BuildingGrid deals={detail.deals} resales={resales} unitDoors={detail.unit_doors ?? []} />
            ) : (
              <>
                <div className="mt-2 overflow-x-auto rounded-[10px] border border-line">
                  <table className="num w-full table-fixed border-collapse text-[10.5px]">
                    <colgroup>
                      <col className="w-[82px] max-mob:w-[72px]" />
                      <col className="w-[104px] max-mob:w-[82px]" />
                      <col className="w-[88px] max-mob:w-[82px]" />
                      <col />
                    </colgroup>
                    <thead>
                      <tr>
                        <th className={dealsTh}>日期</th>
                        <th className={dealsTh}>棟戶・格局</th>
                        <th className={dealsTh}>成交價格</th>
                        <th className={dealsTh}>車位</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listRows.slice(0, 40).map((d, i) => (
                        <tr key={i} className="align-top even:bg-[#f5f7f4]">
                          <td className="whitespace-nowrap p-1.5">
                            <span className="max-mob:hidden">{d.deal_date ?? "—"}</span>
                            <span className="hidden max-mob:inline">{shortRocDate(d.deal_date)}</span>
                          </td>
                          <td className="p-1.5" title={d.unit_id ?? ""}>
                            {d.is_resale ? (
                              <b className="inline-block rounded-full bg-[#f6e8cd] px-1.5 py-0.5 text-[8.5px] font-extrabold text-amber">
                                {d.is_store ? "店面轉售" : "交屋後轉售"}
                              </b>
                            ) : (
                              <b className="block font-extrabold text-ink">{unitLabel(d.unit_id)}</b>
                            )}
                            <small className="mt-0.5 block whitespace-nowrap text-[8.5px] text-ink-soft">
                              {[d.is_resale ? d.addr : null,
                                d.floor_no != null ? `${d.floor_no}樓` : null,
                                d.rooms != null && !d.is_store ? `${d.rooms}房` : null]
                                .filter(Boolean).join("・") || "規格未登錄"}
                            </small>
                          </td>
                          <td className="whitespace-nowrap p-1.5">
                            <b className="block font-bold text-ink">
                              {d.total_price == null ? "—" : `${Math.round(d.total_price).toLocaleString()} 萬`}
                            </b>
                            <small className="mt-0.5 block text-[8.5px] text-ink-soft">
                              {d.unit_price == null ? "單價 —" : `單價 ${fmtP(d.unit_price)} 萬`}
                            </small>
                          </td>
                          <td className="p-1.5"><ListParking deal={d} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {listRows.length > 40 && <div className="mt-[7px] text-right text-[9px] text-ink-soft">顯示最近 40 筆</div>}
              </>
            )}
          </section>

          {(marketRents.length > 0 || socialRents.length > 0) && (
            <section className="mt-[21px]">
              <div className="flex items-baseline gap-2.5 text-[13.5px] font-extrabold">本社區租約
                <span className="num text-[12.5px] text-teal">{marketRents.length} 筆</span>
                {rentMedian != null && (
                  <span className="num text-[9.5px] font-bold text-ink-soft">
                    每坪月租中位 {Math.round(rentMedian).toLocaleString()} 元
                  </span>
                )}
              </div>
              {marketRents.length > 0 && <LeaseTable rows={marketRents} cap={40} />}
              {socialRents.length > 0 && (
                <details className="mt-2">
                  <summary className="py-1.5 text-[11px] font-extrabold text-[#2f7d68]">
                    社會住宅包租代管紀錄（{socialRents.length} 筆）
                  </summary>
                  <div className="mb-1 text-[9.5px] leading-normal text-ink-soft">
                    社宅包租代管租金有政策折價，非市場行情，未計入出租中位數與各級行情統計。
                  </div>
                  <LeaseTable rows={socialRents} cap={20} />
                </details>
              )}
            </section>
          )}

          {cancelled.length > 0 && (
            <details className="mt-[18px] border-t border-line">
              <summary className="py-3 text-[11px] font-extrabold text-teal">解約紀錄（{cancelled.length} 筆）</summary>
              <table className="num w-full border-collapse text-[11px]">
                <thead><tr><th className={dealsTh}>解約日</th><th className={dealsTh}>原成交日</th><th className={dealsTh}>棟戶・樓層</th><th className={dealsTh}>總價</th></tr></thead>
                <tbody>
                  {cancelled.map((d, i) => (
                    <tr key={i} className="even:bg-[#f5f7f4]">
                      <td className="p-1.5">{d.cancel_date ?? "—"}</td>
                      <td className="p-1.5">{d.deal_date ?? "—"}</td>
                      <td className="p-1.5">{unitLabel(d.unit_id)}{d.floor_no != null ? `・${d.floor_no}樓` : ""}</td>
                      <td className="p-1.5">{d.total_price == null ? "—" : `${Math.round(d.total_price).toLocaleString()} 萬`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          {detail.materials && detail.materials.sections.length > 0 && (
            <MaterialsSection sections={detail.materials.sections} pdfUrl={detail.materials.pdf_url} />
          )}

          <div className="mt-[18px] border-t border-line pt-[11px] text-[9px] leading-normal text-ink-soft">
            格內單價已扣除車位價與車位坪數；成交總價仍包含車位。資料來源：內政部實價登錄。
          </div>
        </>
      )}
    </aside>
  );
}
