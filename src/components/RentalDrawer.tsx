"use client";
import { useEffect, useMemo, useState } from "react";
import { Fact, LeaseTable, median, type RLease } from "./drawer-kit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CITIES, cityDisplay } from "@/lib/cities";

// 租賃版抽屜:與建案抽屜同殼,但主角是月租(元)而非成交單價(萬/坪),
// 配色沿用地圖租賃點的棕色系,社宅件折疊另列——避免與預售買賣資料混淆。

type RDetail = {
  key: string; name: string | null; city: string; district: string;
  address: string | null; doors: number;
  build_year: number | null; building_type: string | null;
  project: { city: string; district: string; name: string } | null;
  leases: RLease[];
};

export default function RentalDrawer({ rentalKey, onClose, onOpenProject }: {
  rentalKey: string; onClose: () => void;
  onOpenProject: (p: { city: string; district: string; name: string }) => void;
}) {
  const [detail, setDetail] = useState<RDetail | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    setDetail(null); setErr(false);
    fetch(`/api/rental-detail?key=${encodeURIComponent(rentalKey)}`)
      .then((r) => { if (!r.ok) throw 0; return r.json(); })
      .then(setDetail).catch(() => setErr(true));
  }, [rentalKey]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const market = useMemo(() => (detail?.leases ?? []).filter((l) => l.is_social !== true), [detail]);
  const social = useMemo(() => (detail?.leases ?? []).filter((l) => l.is_social === true), [detail]);
  const monthlyMedian = useMemo(
    () => median(market.map((l) => l.monthly_rent).filter((v): v is number => v != null).map(Number)),
    [market]);
  const perPingMedian = useMemo(
    () => median(market.map((l) => l.rent_per_ping).filter((v): v is number => v != null).map(Number)),
    [market]);
  const areaMedian = useMemo(
    () => median(market.map((l) => l.area_ping).filter((v): v is number => v != null).map(Number)),
    [market]);

  const age = detail?.build_year ? new Date().getFullYear() - detail.build_year : null;
  const title = detail ? (detail.name ?? `${detail.building_type ?? ""}出租住宅`) : "";

  return (
    <aside className="absolute inset-y-0 right-0 z-55 w-[min(480px,100%)] animate-drawer-in overflow-y-auto bg-surface px-6 pb-8 pt-6 shadow-[-12px_0_50px_rgba(18,47,40,.18)] max-mob:top-auto max-mob:h-[min(84%,760px)] max-mob:w-full max-mob:animate-drawer-up max-mob:rounded-t-[20px] max-mob:px-[18px] max-mob:pb-[88px] max-mob:pt-[25px] max-mob:before:absolute max-mob:before:left-1/2 max-mob:before:top-2 max-mob:before:h-1 max-mob:before:w-[42px] max-mob:before:-translate-x-1/2 max-mob:before:rounded-full max-mob:before:bg-[#ced6d2] max-mob:before:content-['']  max-tiny:px-[15px]"
      aria-label="租賃實登資料">
      <Button variant="ghost" size="icon-sm" className="absolute right-4 top-4 size-[31px] rounded-full bg-muted text-muted-foreground"
        onClick={onClose} aria-label="關閉">✕</Button>
      {err && <div className="py-[50px] text-center text-xs text-ink-soft">載入失敗，請重試。</div>}
      {!detail && !err && <div className="py-[50px] text-center text-xs text-ink-soft">載入中…</div>}
      {detail && (
        <>
          <h2 className="my-0.5 mr-[34px] flex flex-wrap items-center gap-[7px] font-display text-[22px] font-bold leading-tight max-mob:text-xl">
            <span>{title}</span>
            <Badge className="h-auto flex-none rounded-full border-0 bg-[#f4e9d8] px-[9px] py-[3px] font-sans text-[10px] font-extrabold leading-[1.4] text-[#7a5328]">
              租賃{age != null ? `・${age} 年屋` : ""}
            </Badge>
          </h2>
          <div className="mb-[13px] mt-[5px] text-[11px] leading-[1.6] text-ink-soft">
            {CITIES.length > 1 ? cityDisplay(detail.city) : ""}{detail.district}
            {detail.address ? `・${detail.address}` : ""}
            {detail.doors > 1 ? `・社區共 ${detail.doors} 個門牌` : ""}
          </div>

          <div className="mb-[11px] rounded-[14px] border border-[#ecdec2] bg-[#faf6ee] p-4">
            <div className="text-xs text-ink-soft">月租中位數<b className="num mx-[3px] text-[31px] tracking-[-.04em] text-ink">{monthlyMedian == null ? "—" : Math.round(monthlyMedian).toLocaleString()}</b>元／月</div>
            <div className="mt-[13px] grid grid-cols-2 gap-2">
              <Fact label="每坪月租中位數" value={perPingMedian == null ? null : `${Math.round(perPingMedian).toLocaleString()} 元`} />
              <Fact label="租賃坪數中位數" value={areaMedian == null ? null : `${areaMedian.toFixed(1)} 坪`} />
            </div>
            <div className="mt-2 text-[9.5px] text-[#78857f]">
              {market[0]?.deal_date ? `最新租約 ${market[0].deal_date}` : "暫無市場租約"}
              ・{market.length} 筆市場租約
              {social.length > 0 ? `・社宅 ${social.length} 筆另列` : ""}
            </div>
          </div>

          {detail.project && (
            <button className="detailbtn"
              onClick={() => onOpenProject(detail.project!)}>
              查看「{detail.project.name}」建案成交與基本資料 →
            </button>
          )}

          {market.length > 0 && (
            <section className="mt-[21px]">
              <div className="flex items-baseline gap-2.5 text-[13.5px] font-extrabold">租約紀錄
                <span className="num text-[12.5px] text-teal">{market.length} 筆</span>
              </div>
              <LeaseTable rows={market} cap={40} />
            </section>
          )}

          {social.length > 0 && (
            <details className="mt-[18px] border-t border-line" open={market.length === 0}>
              <summary className="py-3 text-[11px] font-extrabold text-[#2f7d68]">
                社會住宅包租代管紀錄（{social.length} 筆）
              </summary>
              <div className="mb-2 text-[9.5px] leading-normal text-ink-soft">
                社宅包租代管租金有政策折價，非市場行情，未計入上方中位數與各級行情統計。
              </div>
              <LeaseTable rows={social} cap={20} />
            </details>
          )}

          <div className="mt-[18px] border-t border-line pt-[11px] text-[9px] leading-normal text-ink-soft">
            僅顯示屋齡 1–10 年住宅類租約；門牌為棟級，不含樓層室號。中位數僅計市場件。
            資料來源：內政部實價登錄。
          </div>
        </>
      )}
    </aside>
  );
}
