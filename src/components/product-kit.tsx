import { useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import type { RoomFilter } from "@/lib/rooms";
import { walkMinutes } from "@/lib/geo";
import { TOTAL_FILTERS } from "@/lib/map-const";
import { LIST_SORTS, type ListSort } from "@/lib/map-view";
import { devLabel, devWord } from "@/lib/metrics-core";
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
  recentN: number;                 // 近一年成交筆數
  lastDeal: string | null;
  dev: number | null;              // 比同圈/同區其他預售案 %
  devBase: string | null;
  yieldPct: number | null;         // 年租金 ÷ 總價 %
  yieldSrc: "community" | "nearby" | null;
  cancelRate: number | null;
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
  doors: number;
  isSocial: boolean;
  socialCount: number;
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
    recentN: +(p.recent_n ?? 0),
    lastDeal: p.last_deal ?? null,
    dev: p.dev == null ? null : +p.dev,
    devBase: p.dev_base ?? null,
    yieldPct: p.yield_pct == null ? null : +p.yield_pct,
    yieldSrc: p.yield_src ?? null,
    cancelRate: p.cancel_rate == null ? null : +p.cancel_rate,
  };
}

/** 貴=紅、便宜=綠(沿用台股紅漲綠跌),門檻內不上色。 */
export const devTone = (dev: number) => {
  const word = devWord(dev);
  return word === "貴" ? "border-[#efc8bf] bg-[#faeeeb] text-[#a23e2d]"
    : word === "便宜" ? "border-[#bfdcd2] bg-mint text-teal"
    : "border-line bg-[#f1f3f2] text-ink-soft";
};

/** 「比○○一帶貴 8%」徽章;沒有可比基準就不出現(不硬湊)。 */
export function DevBadge({ dev, base, short, className }: {
  dev: number | null; base: string | null; short?: boolean; className?: string;
}) {
  if (dev == null) return null;
  const full = devWord(dev) === "差不多" ? `和${base ?? "附近"}其他案差不多` : `比${base ?? "附近"}其他案${devLabel(dev)}`;
  return (
    <span title={`${full}(近一年預售成交)`}
      className={cn("num inline-flex flex-none items-center rounded-full border px-[7px] py-[2px] text-[10px] font-extrabold leading-[1.4]", devTone(dev), className)}>
      {short ? devLabel(dev) : full}
    </span>
  );
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
    doors: +(p.doors ?? 1),
    isSocial: p.is_social === true,
    socialCount: +(p.social_count ?? 0),
  };
}

const pct = (v: number | null, digits = 1) => v == null ? "—" : `${v.toFixed(digits)}%`;
const money = (v: number | null) => v == null ? "—" : `${Math.round(v).toLocaleString()} 萬`;
const price = (v: number | null) => v == null ? "—" : `${v.toFixed(1)} 萬/坪`;
const walk = (m: number | null) => m == null ? null : walkMinutes(m);

/* 行動版底欄按鈕的共同覆寫 */
const mobHeadBtn = "max-mob:h-10 max-mob:w-full max-mob:px-[7px] max-mob:text-[11px]";

export function ProductHeader({ market, setMarket, query, setQuery, suggestions, onPick,
  exploreOpen, toggleExplore, listOpen, toggleList, filtersOpen, setFiltersOpen,
  activeFilters, savedCount, openCompare, share, shared }: {
  market: MarketMode; setMarket: (v: MarketMode) => void;
  query: string; setQuery: (v: string) => void;
  suggestions: SearchSuggestion[]; onPick: (s: SearchSuggestion) => void;
  exploreOpen: boolean; toggleExplore: () => void;
  listOpen: boolean; toggleList: () => void;
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
        "flex min-w-0 items-center justify-end gap-[7px] max-mob:fixed max-mob:inset-x-2 max-mob:bottom-[max(8px,env(safe-area-inset-bottom))] max-mob:z-60 max-mob:grid max-mob:h-[54px] max-mob:grid-cols-3 max-mob:gap-1.5 max-mob:rounded-[15px] max-mob:border max-mob:border-line/95 max-mob:bg-surface/96 max-mob:p-1.5 max-mob:shadow-[0_8px_30px_rgba(18,47,40,.18)] max-mob:backdrop-blur-[14px]",
        market === "rental" && "max-mob:hidden", // 租屋模式底欄沒有按鈕(分享只在桌機),整條藏掉
      )}>
        {market === "presale" && <Button variant="head" size="seg" aria-pressed={exploreOpen}
          className={cn("hidden max-mob:inline-flex", mobHeadBtn)}
          onClick={toggleExplore}>找建案</Button>}
        {market === "presale" && <Button variant="head" size="seg" aria-pressed={listOpen}
          className="max-nav:px-[9px] max-mob:hidden" onClick={toggleList}>清單</Button>}
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

const HOUSEHOLD_PRESETS = [
  { label: "不限", min: null, max: null },
  { label: "100戶內", min: null, max: 100 },
  { label: "101–300戶", min: 101, max: 300 },
  { label: "301戶以上", min: 301, max: null },
];

const householdValue = (raw: string) => {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.min(9_999, Math.max(1, Math.round(parsed))) : null;
};

export function FilterPanel({ open, totalBand, setTotalBand, householdMin, householdMax, setHouseholdRange, rooms, setRooms,
  nearMetro, setNearMetro, nearIC, setNearIC, showCancel, setShowCancel, activeOnly, setActiveOnly, reset }: {
  open: boolean;
  totalBand: string; setTotalBand: (v: string) => void;
  householdMin: number | null; householdMax: number | null;
  setHouseholdRange: (min: number | null, max: number | null) => void;
  rooms: RoomFilter; setRooms: (v: RoomFilter) => void;
  nearMetro: boolean; setNearMetro: (v: boolean) => void;
  nearIC: boolean; setNearIC: (v: boolean) => void;
  showCancel: boolean; setShowCancel: (v: boolean) => void;
  activeOnly: boolean; setActiveOnly: (v: boolean) => void;
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
      <FilterGroup label="總戶數">
        <div className="w-full">
          <div className="flex flex-wrap gap-[7px]">
            {HOUSEHOLD_PRESETS.map((preset) => (
              <FilterButton key={preset.label}
                on={householdMin === preset.min && householdMax === preset.max}
                onClick={() => setHouseholdRange(preset.min, preset.max)}>
                {preset.label}
              </FilterButton>
            ))}
          </div>
          <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <HouseholdBoundInput label="最少" value={householdMin}
              onChange={(min) => setHouseholdRange(
                min,
                min != null && householdMax != null && min > householdMax ? min : householdMax,
              )} />
            <span className="text-[12px] font-bold text-ink-soft">—</span>
            <HouseholdBoundInput label="最多" value={householdMax}
              onChange={(max) => setHouseholdRange(
                max != null && householdMin != null && max < householdMin ? max : householdMin,
                max,
              )} />
          </div>
          <p className="mt-1.5 text-[10px] leading-4 text-ink-soft">可輸入任意戶數；留空代表不限制。</p>
        </div>
      </FilterGroup>
      <FilterGroup label="生活條件">
        <FilterButton on={nearMetro} onClick={() => setNearMetro(!nearMetro)}>捷運步行 10 分</FilterButton>
        <FilterButton on={nearIC} onClick={() => setNearIC(!nearIC)}>交流道 2 公里</FilterButton>
      </FilterGroup>
      <FilterGroup label="銷售狀況">
        <FilterButton on={activeOnly} onClick={() => setActiveOnly(!activeOnly)}>近一年有成交</FilterButton>
        <FilterButton on={showCancel} tone="risk" onClick={() => setShowCancel(!showCancel)}>顯示解約案</FilterButton>
      </FilterGroup>
    </section>
  );
}

function HouseholdBoundInput({ label, value, onChange }: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="flex h-10 min-w-0 items-center gap-1.5 rounded-[11px] border border-line bg-white px-2.5 focus-within:border-[#69a99c] focus-within:shadow-[0_0_0_3px_rgba(13,91,79,.08)]">
      <span className="flex-none text-[10px] font-bold text-ink-soft">{label}</span>
      <input type="number" min="1" max="9999" step="10" inputMode="numeric"
        value={value ?? ""} onChange={(event) => onChange(householdValue(event.target.value))}
        aria-label={`${label}總戶數`}
        className="num min-w-0 flex-1 border-0 bg-transparent text-right text-base font-bold outline-none placeholder:text-[#a4adaa]"
        placeholder="不限" />
      <span className="flex-none text-[10px] text-ink-soft">戶</span>
    </label>
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

const compareCell = "min-h-[400px] rounded-2xl border border-line p-[19px] max-mob:min-h-[320px] max-mob:flex-[0_0_84%] max-mob:snap-center";

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
                <CompareRow label="跟附近比" value={p.dev == null ? "樣本不足" : `${devLabel(p.dev)}`}
                  hint={p.dev == null ? undefined : `對照${p.devBase ?? "附近"}`} />
                <CompareRow label="租金回報" value={pct(p.yieldPct)}
                  hint={p.yieldSrc === "community" ? "本社區租約" : p.yieldSrc === "nearby" ? "附近租約換算" : undefined} />
                <CompareRow label="成交樣本" value={`${p.deals} 筆`} hint={p.recentN ? `近一年 ${p.recentN} 筆` : "近一年無成交"} />
                <CompareRow label="最近車站" value={walk(p.stationM) == null ? "—" : `${walk(p.stationM)} 分`} />
                <CompareRow label="解約紀錄" value={p.cancels ? `${p.cancels} 筆` : "未見紀錄"}
                  hint={p.cancelRate ? `佔 ${p.cancelRate.toFixed(1)}%` : undefined} />
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

function CompareRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex justify-between gap-3 border-t border-[#edf0ee] py-2.5 text-[11.5px]">
      <span className="text-ink-soft">{label}</span>
      <span className="text-right">
        <b className="num">{value}</b>
        {hint && <small className="block text-[9px] text-ink-soft">{hint}</small>}
      </span>
    </div>
  );
}

/** 排序 chips:清單面板與行動版「找建案」共用 */
export function SortChips({ sort, setSort, className }: {
  sort: ListSort; setSort: (s: ListSort) => void; className?: string;
}) {
  return (
    <div className={cn("flex gap-1.5 overflow-x-auto pb-1", className)} role="group" aria-label="排序方式">
      {LIST_SORTS.map(({ key, label }) => (
        <button key={key} type="button" aria-pressed={sort === key} onClick={() => setSort(key)}
          className="h-[30px] flex-none rounded-full border border-line bg-white px-2.5 text-[10.5px] font-bold text-[#52615c] aria-pressed:border-teal aria-pressed:bg-teal aria-pressed:text-white">
          {label}
        </button>
      ))}
    </div>
  );
}

/** 建案清單列:名稱+一坪價,下面一行是判讀(跟附近比、租金回報、解約) */
export function ProjectRow({ project, onOpen, showCity }: {
  project: ProjectSummary; onOpen: (p: ProjectSummary) => void; showCity?: string;
}) {
  const p = project;
  return (
    <button type="button" onClick={() => onOpen(p)}
      className="group block w-full border-0 border-b border-line/70 bg-white px-3 py-2.5 text-left last:border-b-0 hover:bg-[#f7faf8] active:bg-mint/50">
      <span className="flex items-baseline gap-2">
        <b className="min-w-0 flex-1 truncate text-[13px]">{p.name}</b>
        <span className="num flex-none text-[13px] font-extrabold text-teal">
          {p.price == null ? "—" : p.price.toFixed(1)}<small className="ml-0.5 text-[9px] font-bold text-ink-soft">萬/坪</small>
        </span>
      </span>
      <span className="mt-1 flex items-baseline gap-2 text-[10.5px] text-ink-soft">
        <span className="min-w-0 flex-1 truncate">
          {showCity ? `${showCity}・` : ""}{p.district}
          {p.total != null ? `・一戶約 ${Math.round(p.total).toLocaleString()} 萬` : ""}
        </span>
        <span className="num flex-none">{p.recentN > 0 ? `近一年 ${p.recentN} 筆` : p.lastDeal ? `最後成交 ${p.lastDeal.slice(0, 7)}` : `${p.deals} 筆`}</span>
      </span>
      {(p.dev != null || p.yieldPct != null || p.cancels > 0) && (
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <DevBadge dev={p.dev} base={p.devBase} />
          {p.yieldPct != null && (
            <span className="num inline-flex items-center rounded-full border border-line bg-white px-[7px] py-[2px] text-[10px] font-bold leading-[1.4] text-ink"
              title={p.yieldSrc === "community" ? "以本社區實際租約計算" : "以附近屋齡 1–10 年租約換算"}>
              租金回報 {p.yieldPct.toFixed(1)}%
            </span>
          )}
          {p.cancels > 0 && (
            <span className="num inline-flex items-center rounded-full border border-[#efc8bf] bg-white px-[7px] py-[2px] text-[10px] font-bold leading-[1.4] text-[#a23e2d]">
              解約 {p.cancels} 筆
            </span>
          )}
        </span>
      )}
    </button>
  );
}

const LIST_PAGE = 40;

/** 桌機左側清單:目前篩選條件(可再限縮到地圖範圍)下的建案,依選定的問題排序。 */
export function ProjectListPanel({ open, onClose, projects, total, sort, setSort,
  scopeToView, setScopeToView, onOpen, loading, multiCity }: {
  open: boolean; onClose: () => void;
  projects: ProjectSummary[];       // 已套篩選/範圍/排序
  total: number;                    // 套篩選但不限地圖範圍的總數
  sort: ListSort; setSort: (s: ListSort) => void;
  scopeToView: boolean; setScopeToView: (v: boolean) => void;
  onOpen: (p: ProjectSummary) => void; loading: boolean;
  multiCity: (city: string) => string | undefined;
}) {
  const [limit, setLimit] = useState(LIST_PAGE);
  const shown = projects.slice(0, limit);
  const noMetric = sort === "cheap" ? projects.findIndex((p) => p.dev == null)
    : sort === "yield" ? projects.findIndex((p) => p.yieldPct == null) : -1;
  return (
    <section aria-label="建案清單" className={cn(
      "absolute bottom-6 left-4 top-24 z-20 flex w-[348px] flex-col overflow-hidden rounded-[17px] border border-line bg-surface/98 shadow-lift transition-[opacity,transform,visibility] duration-180 max-mob:hidden",
      open ? "visible translate-x-0 opacity-100" : "invisible -translate-x-3 opacity-0",
    )}>
      <div className="flex-none border-b border-line px-3.5 pb-2.5 pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <strong className="text-[14px]">
            <span className="num text-teal">{loading ? "…" : projects.length.toLocaleString()}</span> 個建案
            {scopeToView && !loading && projects.length !== total && (
              <span className="ml-1 text-[10px] font-bold text-ink-soft">／全部 {total.toLocaleString()}</span>
            )}
          </strong>
          <button type="button" onClick={onClose} aria-label="收起清單"
            className="grid size-7 place-items-center rounded-full border-0 bg-muted text-[15px] text-ink-soft">×</button>
        </div>
        <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[10.5px] text-ink-soft">
          <input type="checkbox" checked={scopeToView} onChange={(e) => { setScopeToView(e.target.checked); setLimit(LIST_PAGE); }}
            className="size-3.5 accent-[#0d5b4f]" />
          只看目前地圖範圍內
        </label>
        <SortChips sort={sort} setSort={(s) => { setSort(s); setLimit(LIST_PAGE); }} className="mt-2" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="grid min-h-40 place-items-center text-[12px] text-ink-soft">建案資料載入中…</div>
        ) : projects.length === 0 ? (
          <EmptyState title="這個範圍沒有符合的建案" hint="移動或縮小地圖、取消「只看地圖範圍內」，或放寬篩選條件。" />
        ) : (
          <>
            {shown.map((p, i) => (
              <div key={p.key}>
                {i === noMetric && (
                  <div className="border-b border-line/70 bg-[#faf9f5] px-3 py-1.5 text-[9.5px] leading-normal text-ink-soft">
                    以下建案{sort === "cheap" ? "近一年成交太少或附近可比的案不夠，無法比較" : "附近租約樣本不足，無法換算"}
                  </div>
                )}
                <ProjectRow project={p} onOpen={onOpen} showCity={multiCity(p.city)} />
              </div>
            ))}
            {projects.length > shown.length && (
              <button type="button" onClick={() => setLimit((n) => n + LIST_PAGE)}
                className="w-full border-0 bg-[#faf9f5] py-3 text-[11px] font-extrabold text-teal">
                再看 {Math.min(LIST_PAGE, projects.length - shown.length)} 個（還有 {(projects.length - shown.length).toLocaleString()} 個）
              </button>
            )}
          </>
        )}
      </div>
      <div className="flex-none border-t border-line px-3.5 py-2 text-[9px] leading-normal text-ink-soft">
        「跟附近比」只比近一年成交，對照同生活圈其他預售案（樣本不足改用行政區）。租金回報＝年租金÷總價，未扣稅費與空置。
      </div>
    </section>
  );
}
