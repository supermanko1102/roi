import { useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import type { RoomFilter } from "@/lib/rooms";
import { walkMinutes } from "@/lib/geo";
import { TOTAL_FILTERS } from "@/lib/map-const";
import type { PresaleFeature, RentalFeature, SearchSuggestion } from "@/lib/map-types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type MarketMode = "presale" | "rental";

const SUGGEST_KIND: Record<SearchSuggestion["kind"], string> = {
  project: "建案", district: "行政區", zone: "生活圈", rental: "社區",
};

export type ProjectSummary = {
  key: string;
  name: string;
  city: string;
  district: string;
  lng: number;
  lat: number;
  price: number | null;
  total: number | null;
  area: number | null;
  deals: number;
  cancels: number;
  stationM: number | null;
};

export type RentalSummary = {
  key: string;
  name: string | null;
  city: string;
  district: string;
  address: string;
  buildingType: string;
  lng: number;
  lat: number;
  age: number;
  monthlyRent: number;
  housingRent: number;
  parkingRent: number | null;
  area: number;
  rentPerPing: number;
  deals: number;
  lastDeal: string | null;
};

export function summaryFromFeature(f: PresaleFeature): ProjectSummary {
  const p = f.properties;
  return {
    key: `${p.city}|${p.district}|${p.name}`,
    name: p.name!,
    city: p.city,
    district: p.district,
    lng: +f.geometry.coordinates[0],
    lat: +f.geometry.coordinates[1],
    price: p.price == null ? null : +p.price,
    total: p.median_total == null ? null : +p.median_total,
    area: p.median_area == null ? null : +p.median_area,
    deals: +(p.deal_count ?? 0),
    cancels: +(p.cancel_count ?? 0),
    stationM: p.st_m == null ? null : +p.st_m,
  };
}

export function rentalSummaryFromFeature(f: RentalFeature): RentalSummary {
  const p = f.properties;
  return {
    key: p.key,
    name: p.name ?? null,
    city: p.city,
    district: p.district,
    address: p.address,
    buildingType: p.building_type,
    lng: +f.geometry.coordinates[0],
    lat: +f.geometry.coordinates[1],
    age: +p.age,
    monthlyRent: +p.monthly_rent,
    housingRent: +(p.housing_rent ?? p.monthly_rent),
    parkingRent: p.parking_rent == null ? null : +p.parking_rent,
    area: +p.area_ping,
    rentPerPing: +p.rent_per_ping,
    deals: +p.deal_count,
    lastDeal: p.last_deal ?? null,
  };
}

const money = (v: number | null) => v == null ? "—" : `${Math.round(v).toLocaleString()} 萬`;
const price = (v: number | null) => v == null ? "—" : `${v.toFixed(1)} 萬/坪`;
const walk = (m: number | null) => m == null ? null : walkMinutes(m);

/* 行動版底欄按鈕的共同覆寫 */
const mobHeadBtn = "max-mob:h-10 max-mob:w-full max-mob:px-[7px] max-mob:text-[11px]";

export function ProductHeader({ market, setMarket, query, setQuery, suggestions, onPick,
  filtersOpen, setFiltersOpen, activeFilters, savedCount, openCompare, share, shared }: {
  market: MarketMode; setMarket: (v: MarketMode) => void;
  query: string; setQuery: (v: string) => void;
  suggestions: SearchSuggestion[]; onPick: (s: SearchSuggestion) => void;
  filtersOpen: boolean; setFiltersOpen: (v: boolean) => void;
  activeFilters: number; savedCount: number; openCompare: () => void;
  share: () => void; shared: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const open = focused && suggestions.length > 0;
  function pick(s: SearchSuggestion) {
    onPick(s);
    setFocused(false);
    inputRef.current?.blur(); // 行動版順便收鍵盤
  }
  return (
    <header className="absolute inset-x-4 top-3.5 z-25 grid min-h-[70px] grid-cols-[235px_auto_minmax(220px,1fr)_auto] items-center gap-[18px] rounded-[18px] border border-line/90 bg-surface/94 px-3 py-2.5 shadow-[0_8px_32px_rgba(18,47,40,.12)] backdrop-blur-[18px] max-nav:grid-cols-[188px_auto_minmax(170px,1fr)_auto] max-nav:gap-2.5 max-mob:inset-x-2 max-mob:top-2 max-mob:min-h-24 max-mob:grid-cols-[auto_1fr] max-mob:grid-rows-[34px_42px] max-mob:gap-x-2.5 max-mob:gap-y-[7px] max-mob:rounded-[15px] max-mob:bg-surface/98 max-mob:px-[9px] max-mob:py-[7px] max-mob:backdrop-blur-none">
      <div className="flex min-w-0 items-center gap-[11px]">
        <Image
          src="/brand/fangshi-tantan-logo-192.png"
          width={42}
          height={42}
          alt=""
          priority
          aria-hidden="true"
          className="size-[42px] flex-none object-contain max-mob:size-8"
        />
        <div>
          <div className="text-[15px] font-extrabold leading-tight tracking-[.04em] max-mob:whitespace-nowrap max-mob:text-[13px] max-tiny:text-xs">房市探探</div>
          <div className="mt-1 whitespace-nowrap text-[10.5px] text-ink-soft max-nav:hidden">北北桃預售與租賃實價登錄</div>
        </div>
      </div>
      <div className="flex rounded-[11px] bg-secondary p-[3px] max-mob:justify-self-end max-mob:p-0.5" role="group" aria-label="資料類型">
        <Button variant="seg" size="seg" aria-pressed={market === "presale"}
          className="max-mob:h-[30px] max-mob:px-2.5 max-mob:text-[11px]"
          onClick={() => setMarket("presale")}>預售屋</Button>
        <Button variant="seg" size="seg" aria-pressed={market === "rental"}
          className="max-mob:h-[30px] max-mob:px-2.5 max-mob:text-[11px]"
          onClick={() => setMarket("rental")}>租屋</Button>
      </div>
      <label className="relative flex h-[46px] items-center gap-[9px] rounded-[13px] border border-line bg-white px-[13px] transition-[border-color,box-shadow] duration-150 focus-within:border-[#69a99c] focus-within:shadow-[0_0_0_4px_rgba(13,91,79,.08)] max-mob:col-span-full max-mob:row-start-2 max-mob:h-10">
        <span className="rotate-[-18deg] text-[22px] text-teal" aria-hidden="true">⌕</span>
        {/* 行動版字級固定 16px:iOS 聚焦時 <16px 會強制放大整頁導致跑版 */}
        <input ref={inputRef} value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % suggestions.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + suggestions.length) % suggestions.length); }
            else if (e.key === "Enter") { e.preventDefault(); pick(suggestions[Math.min(active, suggestions.length - 1)]); }
            else if (e.key === "Escape") inputRef.current?.blur();
          }}
          className="w-full min-w-0 border-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-[#93a09b] max-mob:text-base"
          placeholder={market === "presale" ? "搜尋建案、行政區" : "搜尋社區、地址、行政區"}
          aria-label={market === "presale" ? "搜尋建案或行政區" : "搜尋租屋社區、地址或行政區"} />
        {query && <button className="border-0 bg-transparent text-xl text-[#7c8984]" onClick={() => setQuery("")} aria-label="清除搜尋">×</button>}
        {open && (
          <div className="absolute inset-x-0 top-[calc(100%+7px)] z-30 max-h-[min(320px,46vh)] overflow-y-auto rounded-[13px] border border-line bg-surface py-1 shadow-lift" role="listbox" aria-label="搜尋建議">
            {suggestions.map((s, i) => (
              <button key={`${s.kind}|${s.key}`} type="button" role="option" aria-selected={i === active}
                className={cn("flex w-full items-center gap-2 border-0 bg-transparent px-3 py-2.5 text-left", i === active && "bg-secondary")}
                onMouseDown={(e) => e.preventDefault()} // 搶在 blur 前,不然點擊還沒觸發下拉就收掉了
                onClick={() => pick(s)}
                onMouseEnter={() => setActive(i)}>
                <span className="flex-none rounded-full bg-muted px-[7px] py-[3px] text-[9.5px] text-muted-foreground">{SUGGEST_KIND[s.kind]}</span>
                <span className="min-w-0 truncate text-[13px] font-bold">{s.label}</span>
                {s.sub && <span className="ml-auto flex-none whitespace-nowrap text-[10.5px] text-ink-soft">{s.sub}</span>}
              </button>
            ))}
          </div>
        )}
      </label>
      <div className={cn(
        "flex min-w-0 items-center justify-end gap-[7px] max-mob:fixed max-mob:inset-x-2 max-mob:bottom-[max(8px,env(safe-area-inset-bottom))] max-mob:z-60 max-mob:grid max-mob:h-[54px] max-mob:grid-cols-2 max-mob:gap-1.5 max-mob:rounded-[15px] max-mob:border max-mob:border-line/95 max-mob:bg-surface/96 max-mob:p-1.5 max-mob:shadow-[0_8px_30px_rgba(18,47,40,.18)] max-mob:backdrop-blur-[14px]",
        market === "rental" && "max-mob:hidden", // 租屋模式底欄沒有按鈕(分享只在桌機),整條藏掉
      )}>
        {market === "presale" && <Button variant="head" size="seg" aria-pressed={filtersOpen}
          className={cn("max-nav:px-[9px]", mobHeadBtn)}
          onClick={() => setFiltersOpen(!filtersOpen)}>篩選{activeFilters ? ` ${activeFilters}` : ""}</Button>}
        {market === "presale" && <Button variant="head" size="seg" className={cn("max-nav:px-[9px]", mobHeadBtn)}
          onClick={openCompare}>比較 {savedCount}/3</Button>}
        <Button variant="head" size="seg" className="text-teal max-nav:hidden" onClick={share}>{shared ? "已複製" : "分享"}</Button>
      </div>
    </header>
  );
}

export function FilterPanel({ open, totalBand, setTotalBand, rooms, setRooms,
  nearMetro, setNearMetro, nearIC, setNearIC, showCancel, setShowCancel, reset }: {
  open: boolean;
  totalBand: string; setTotalBand: (v: string) => void;
  rooms: RoomFilter; setRooms: (v: RoomFilter) => void;
  nearMetro: boolean; setNearMetro: (v: boolean) => void;
  nearIC: boolean; setNearIC: (v: boolean) => void;
  showCancel: boolean; setShowCancel: (v: boolean) => void;
  reset: () => void;
}) {
  const roomItems: [RoomFilter, string][] = [
    ["all", "不限"], ["1", "1房"], ["2", "2房"], ["3", "3房"], ["4p", "4房以上"],
  ];
  return (
    <section className={cn(
      "absolute right-4 top-24 z-24 w-[min(650px,calc(100vw-32px))] rounded-[17px] border border-line bg-surface/98 p-[18px] shadow-lift transition-[opacity,transform,visibility] duration-180 max-mob:fixed max-mob:inset-x-2 max-mob:bottom-[70px] max-mob:top-auto max-mob:z-58 max-mob:max-h-[calc(100vh-186px)] max-mob:w-auto max-mob:overflow-y-auto max-mob:rounded-2xl max-mob:p-[15px]",
      open ? "visible translate-y-0 opacity-100" : "invisible -translate-y-2 opacity-0 max-mob:translate-y-3",
    )} aria-label="建案篩選">
      <div className="mb-[15px] flex items-center justify-between">
        <strong className="text-[15px]">縮小選房範圍</strong>
        <Button variant="link" className="h-auto p-0 text-[11.5px] font-bold text-teal no-underline hover:underline"
          onClick={reset}>全部清除</Button>
      </div>
      <FilterGroup label="成交總價">
        {TOTAL_FILTERS.map(({ key, label }) => <FilterButton key={key} on={totalBand === key}
          onClick={() => setTotalBand(key)}>{label}</FilterButton>)}
      </FilterGroup>
      <FilterGroup label="房型">
        {roomItems.map(([key, label]) => <FilterButton key={key} on={rooms === key}
          onClick={() => setRooms(key)}>{label}</FilterButton>)}
      </FilterGroup>
      <FilterGroup label="生活條件">
        <FilterButton on={nearMetro} onClick={() => setNearMetro(!nearMetro)}>捷運步行 10 分</FilterButton>
        <FilterButton on={nearIC} onClick={() => setNearIC(!nearIC)}>交流道 2 公里</FilterButton>
        <FilterButton on={showCancel} tone="risk" onClick={() => setShowCancel(!showCancel)}>顯示解約案</FilterButton>
      </FilterGroup>
    </section>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[82px_1fr] items-start gap-3.5 border-t border-[#e8ece9] py-[9px] max-mob:grid-cols-1 max-mob:gap-1">
      <span className="pt-2 text-[11.5px] font-bold text-ink-soft max-mob:pt-0.5">{label}</span>
      <div className="flex flex-wrap gap-[7px]">{children}</div>
    </div>
  );
}

function FilterButton({ on, onClick, tone, children }: {
  on: boolean; onClick: () => void; tone?: "risk"; children: ReactNode;
}) {
  return (
    <Button variant="pill" size="pill" aria-pressed={on} onClick={onClick}
      className={cn("max-tiny:px-2.5", tone === "risk" && "aria-pressed:border-coral aria-pressed:bg-coral")}>
      {children}
    </Button>
  );
}

function EmptyState({ title, hint, large }: { title: string; hint: string; large?: boolean }) {
  return (
    <div className={cn("flex min-h-[190px] flex-col items-center justify-center gap-[7px] p-7 text-center", large && "min-h-[250px]")}>
      <b className="text-sm">{title}</b>
      <span className="max-w-[300px] text-[11.5px] leading-[1.6] text-ink-soft">{hint}</span>
    </div>
  );
}

const compareCell = "min-h-[330px] rounded-2xl border border-line p-[19px] max-mob:min-h-[320px] max-mob:flex-[0_0_84%] max-mob:snap-center";

export function ComparePanel({ open, saved, onClose, onRemove, onOpen }: {
  open: boolean; saved: ProjectSummary[]; onClose: () => void;
  onRemove: (p: ProjectSummary) => void; onOpen: (p: ProjectSummary) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent showCloseButton={false}
        overlayClassName="z-70 bg-[#081c18]/55 supports-backdrop-filter:backdrop-blur-sm"
        className="z-70 block max-h-[min(760px,calc(100vh-48px))] w-[min(1020px,calc(100vw-48px))] max-w-none gap-0 overflow-y-auto rounded-[22px] bg-surface p-6 shadow-[0_28px_90px_rgba(0,0,0,.26)] ring-0 sm:max-w-none max-mob:bottom-0 max-mob:left-0 max-mob:top-auto max-mob:w-full max-mob:max-w-full max-mob:translate-x-0 max-mob:translate-y-0 max-mob:max-h-[88vh] max-mob:rounded-b-none max-mob:px-3.5 max-mob:pb-[calc(20px+env(safe-area-inset-bottom))] max-mob:pt-[19px] max-mob:data-open:slide-in-from-bottom-4">
        <div className="mb-[22px] flex items-start justify-between">
          <div>
            <span className="text-[9.5px] font-extrabold tracking-[.18em] text-teal">SHORTLIST</span>
            <DialogTitle className="mt-[3px] font-display text-[26px] font-bold leading-[1.1]">建案比較</DialogTitle>
          </div>
          <DialogClose aria-label="關閉比較"
            render={<Button variant="secondary" size="icon" className="size-9 rounded-full bg-muted text-[21px]" />}>
            ×
          </DialogClose>
        </div>
        {saved.length === 0 ? (
          <EmptyState large title="還沒有比較名單" hint="在建案詳情按下星號，最多加入三個建案。" />
        ) : (
          <div className="grid grid-cols-3 gap-3 max-mob:flex max-mob:snap-x max-mob:snap-mandatory max-mob:overflow-x-auto max-mob:pb-[5px]">
            {saved.map((p) => (
              <article className={cn("relative bg-white", compareCell)} key={p.key}>
                <Button variant="secondary" size="icon-sm" className="absolute right-[13px] top-[13px] size-7 rounded-full bg-[#f1f3f2]"
                  onClick={() => onRemove(p)} aria-label={`移除${p.name}`}>×</Button>
                <span className="text-[10.5px] font-extrabold text-teal">{p.district}</span>
                <h3 className="mb-[7px] mr-7 mt-[5px] min-h-[42px] text-[17px] font-bold leading-[1.35]">{p.name}</h3>
                <Button variant="link" className="mb-[13px] h-auto p-0 text-[11px] font-bold text-teal no-underline hover:underline"
                  onClick={() => onOpen(p)}>查看成交紀錄 →</Button>
                <CompareRow label="成交總價" value={money(p.total)} />
                <CompareRow label="單價" value={price(p.price)} />
                <CompareRow label="坪數" value={p.area == null ? "—" : `${Math.round(p.area)} 坪`} />
                <CompareRow label="成交樣本" value={`${p.deals} 筆`} />
                <CompareRow label="最近車站" value={walk(p.stationM) == null ? "—" : `${walk(p.stationM)} 分`} />
                <CompareRow label="解約紀錄" value={p.cancels ? `${p.cancels} 筆` : "未見紀錄"} />
              </article>
            ))}
            {Array.from({ length: 3 - saved.length }).map((_, i) => (
              <div className={cn("grid place-items-center border-dashed bg-[#faf9f5] text-xs text-[#8d9894]", compareCell)} key={i}>還可加入一個建案</div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CompareRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-t border-[#edf0ee] py-2.5 text-[11.5px]">
      <span className="text-ink-soft">{label}</span>
      <b className="num text-right">{value}</b>
    </div>
  );
}
