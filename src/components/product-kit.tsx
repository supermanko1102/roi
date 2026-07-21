import type { ReactNode } from "react";
import type { RoomFilter } from "@/lib/rooms";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ViewMode = "map" | "list";
export type MarketMode = "presale" | "rental";

export type ProjectSummary = {
  key: string;
  name: string;
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

export function summaryFromFeature(f: any): ProjectSummary {
  const p = f.properties;
  return {
    key: `${p.district}|${p.name}`,
    name: p.name,
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

export function rentalSummaryFromFeature(f: any): RentalSummary {
  const p = f.properties;
  return {
    key: p.key,
    name: p.name ?? null,
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
const walk = (m: number | null) => m == null ? null : Math.max(1, Math.round(m * 1.3 / 80));

/* 行動版底欄按鈕的共同覆寫 */
const mobHeadBtn = "max-mob:h-10 max-mob:w-full max-mob:px-[7px] max-mob:text-[11px]";

export function ProductHeader({ market, setMarket, query, setQuery, view, setView, filtersOpen, setFiltersOpen,
  activeFilters, savedCount, openCompare, share, shared }: {
  market: MarketMode; setMarket: (v: MarketMode) => void;
  query: string; setQuery: (v: string) => void;
  view: ViewMode; setView: (v: ViewMode) => void;
  filtersOpen: boolean; setFiltersOpen: (v: boolean) => void;
  activeFilters: number; savedCount: number; openCompare: () => void;
  share: () => void; shared: boolean;
}) {
  return (
    <header className="absolute inset-x-4 top-3.5 z-25 grid min-h-[70px] grid-cols-[235px_auto_minmax(220px,1fr)_auto] items-center gap-[18px] rounded-[18px] border border-line/90 bg-surface/94 px-3 py-2.5 shadow-[0_8px_32px_rgba(18,47,40,.12)] backdrop-blur-[18px] max-nav:grid-cols-[188px_auto_minmax(170px,1fr)_auto] max-nav:gap-2.5 max-mob:inset-x-2 max-mob:top-2 max-mob:min-h-24 max-mob:grid-cols-[auto_1fr] max-mob:grid-rows-[34px_42px] max-mob:gap-x-2.5 max-mob:gap-y-[7px] max-mob:rounded-[15px] max-mob:bg-surface/98 max-mob:px-[9px] max-mob:py-[7px] max-mob:backdrop-blur-none">
      <div className="flex min-w-0 items-center gap-[11px]">
        <div className="grid size-[42px] flex-none place-items-center rounded-[13px] bg-teal-dark font-display text-xl font-extrabold leading-none text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.14)] max-mob:size-8 max-mob:rounded-[10px] max-mob:text-base" aria-hidden="true">R</div>
        <div>
          <div className="text-[15px] font-extrabold leading-tight tracking-[.04em] max-mob:whitespace-nowrap max-mob:text-[13px] max-tiny:text-xs">桃園預售・租屋</div>
          <div className="mt-1 whitespace-nowrap text-[10.5px] text-ink-soft max-nav:hidden">預售成交與租賃實價登錄</div>
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
      <label className="flex h-[46px] items-center gap-[9px] rounded-[13px] border border-line bg-white px-[13px] transition-[border-color,box-shadow] duration-150 focus-within:border-[#69a99c] focus-within:shadow-[0_0_0_4px_rgba(13,91,79,.08)] max-mob:col-span-full max-mob:row-start-2 max-mob:h-10">
        <span className="-rotate-[18deg] text-[22px] text-teal" aria-hidden="true">⌕</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          className="w-full min-w-0 border-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-[#93a09b]"
          placeholder={market === "presale" ? "搜尋建案、行政區" : "搜尋社區、地址、行政區"}
          aria-label={market === "presale" ? "搜尋建案或行政區" : "搜尋租屋社區、地址或行政區"} />
        {query && <button className="border-0 bg-transparent text-xl text-[#7c8984]" onClick={() => setQuery("")} aria-label="清除搜尋">×</button>}
      </label>
      <div className={cn(
        "flex min-w-0 items-center justify-end gap-[7px] max-mob:fixed max-mob:inset-x-2 max-mob:bottom-[max(8px,env(safe-area-inset-bottom))] max-mob:z-60 max-mob:grid max-mob:h-[54px] max-mob:grid-cols-3 max-mob:gap-1.5 max-mob:rounded-[15px] max-mob:border max-mob:border-line/95 max-mob:bg-surface/96 max-mob:p-1.5 max-mob:shadow-[0_8px_30px_rgba(18,47,40,.18)] max-mob:backdrop-blur-[14px] max-tiny:grid-cols-[1.25fr_1fr_1fr]",
        market === "rental" && "max-mob:grid-cols-1",
      )}>
        <div className="flex rounded-[11px] bg-secondary p-[3px] max-mob:grid max-mob:min-w-0 max-mob:grid-cols-2" role="group" aria-label="檢視模式">
          <Button variant="seg" size="seg" aria-pressed={view === "map"} className={mobHeadBtn}
            onClick={() => setView("map")}>地圖</Button>
          <Button variant="seg" size="seg" aria-pressed={view === "list"} className={mobHeadBtn}
            onClick={() => setView("list")}>列表</Button>
        </div>
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
  const budgets = [
    ["all", "不限"], ["1000", "1,000萬內"], ["1500", "1,000–1,500萬"],
    ["2000", "1,500–2,000萬"], ["2000p", "2,000萬以上"],
  ];
  const roomItems: [RoomFilter, string][] = [
    ["all", "不限"], ["1", "1房"], ["2", "2房"], ["3", "3房"], ["4p", "4房以上"],
  ];
  return (
    <section className={cn(
      "absolute right-4 top-24 z-24 w-[min(650px,calc(100vw-32px))] rounded-[17px] border border-line bg-surface/98 p-[18px] shadow-lift transition-[opacity,transform,visibility] duration-[180ms] max-mob:fixed max-mob:inset-x-2 max-mob:bottom-[70px] max-mob:top-auto max-mob:z-58 max-mob:max-h-[calc(100vh-186px)] max-mob:w-auto max-mob:overflow-y-auto max-mob:rounded-2xl max-mob:p-[15px]",
      open ? "visible translate-y-0 opacity-100" : "invisible -translate-y-2 opacity-0 max-mob:translate-y-3",
    )} aria-label="建案篩選">
      <div className="mb-[15px] flex items-center justify-between">
        <strong className="text-[15px]">縮小選房範圍</strong>
        <Button variant="link" className="h-auto p-0 text-[11.5px] font-bold text-teal no-underline hover:underline"
          onClick={reset}>全部清除</Button>
      </div>
      <FilterGroup label="成交總價">
        {budgets.map(([key, label]) => <FilterButton key={key} on={totalBand === key}
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

/* 疊在地圖上的側欄／面板容器 */
const panelShell = (open: boolean) => cn(
  "absolute bottom-[22px] left-4 top-[98px] z-20 flex w-[min(390px,calc(100vw-32px))] flex-col overflow-hidden rounded-[18px] border border-line bg-surface/98 shadow-lift transition-[opacity,transform,visibility] duration-200 max-mob:fixed max-mob:inset-x-0 max-mob:bottom-[69px] max-mob:top-28 max-mob:z-22 max-mob:w-full max-mob:rounded-b-none max-mob:rounded-t-[18px] max-mob:border-x-0 max-mob:border-b-0",
  open ? "visible translate-x-0 opacity-100 max-mob:translate-y-0"
    : "invisible -translate-x-[18px] opacity-0 max-mob:translate-x-0 max-mob:translate-y-[18px]",
);
const resultsHead = "flex items-baseline justify-between border-b border-[#e8ece9] px-[18px] pb-[13px] pt-[17px] max-mob:px-4 max-mob:pb-2.5 max-mob:pt-[13px]";
const resultScroll = "min-h-0 overflow-y-auto overscroll-contain px-2.5 pb-3.5 pt-[7px] max-mob:pb-5";
const resultFacts = "mt-2 flex flex-wrap gap-x-[13px] gap-y-[5px] text-[10.5px] text-ink-soft [&_span:not(:first-child)]:before:mr-2 [&_span:not(:first-child)]:before:text-[#a3ada9] [&_span:not(:first-child)]:before:content-['·']";

function EmptyState({ title, hint, large }: { title: string; hint: string; large?: boolean }) {
  return (
    <div className={cn("flex min-h-[190px] flex-col items-center justify-center gap-[7px] p-7 text-center", large && "min-h-[250px]")}>
      <b className="text-sm">{title}</b>
      <span className="max-w-[300px] text-[11.5px] leading-[1.6] text-ink-soft">{hint}</span>
    </div>
  );
}

function DistrictBadge({ children }: { children: ReactNode }) {
  return <Badge variant="secondary" className="h-auto flex-none rounded-full border-0 bg-muted px-[7px] py-0.5 text-[9.5px] font-normal text-muted-foreground">{children}</Badge>;
}

export function ResultsPanel({ open, projects, totalCount, saved, onOpen, onToggleSaved }: {
  open: boolean; projects: ProjectSummary[]; totalCount: number; saved: ProjectSummary[];
  onOpen: (p: ProjectSummary) => void; onToggleSaved: (p: ProjectSummary) => void;
}) {
  const savedKeys = new Set(saved.map((p) => p.key));
  return (
    <aside className={panelShell(open)} aria-label="建案列表">
      <div className={resultsHead}>
        <div className="text-xs font-bold"><strong className="text-xl text-teal">{totalCount}</strong> 個符合建案</div>
        <span className="text-[10.5px] text-ink-soft">依建案名稱排序</span>
      </div>
      <div className={resultScroll}>
        {projects.length === 0 && <EmptyState title="沒有符合條件的建案" hint="試著放寬總價、房型或交通條件。" />}
        {projects.map((p) => (
          <article className="relative flex border-b border-[#e7ebe8] last:border-b-0" key={p.key}>
            <button className="group w-full border-0 bg-transparent py-3.5 pl-2 pr-10 text-left" onClick={() => onOpen(p)}>
              <div className="flex items-center gap-2">
                <strong className="truncate text-sm transition-colors duration-150 group-hover:text-teal">{p.name}</strong>
                <DistrictBadge>{p.district}</DistrictBadge>
              </div>
              <div className="mt-2 flex items-baseline gap-2.5">
                <b className="num text-[17px] text-ink">{money(p.total)}</b>
                <span className="text-[11px] text-ink-soft">{price(p.price)}</span>
              </div>
              <div className={resultFacts}>
                {p.area != null && <span>{Math.round(p.area)} 坪</span>}
                <span>{p.deals} 筆成交</span>
                {walk(p.stationM) != null && <span>步行 {walk(p.stationM)} 分</span>}
              </div>
            </button>
            <button className="absolute right-[5px] top-[13px] size-[33px] rounded-full border-0 bg-transparent text-[22px] text-[#7f8d87] hover:bg-[#f3ead8] hover:text-amber aria-pressed:bg-[#f3ead8] aria-pressed:text-amber"
              onClick={() => onToggleSaved(p)} aria-label={`${savedKeys.has(p.key) ? "移除" : "加入"}${p.name}比較`}
              aria-pressed={savedKeys.has(p.key)}>☆</button>
          </article>
        ))}
      </div>
    </aside>
  );
}

export function RentalResultsPanel({ open, rentals, totalCount, onOpen }: {
  open: boolean; rentals: RentalSummary[]; totalCount: number; onOpen: (r: RentalSummary) => void;
}) {
  return (
    <aside className={panelShell(open)} aria-label="租屋列表">
      <div className={resultsHead}>
        <div className="text-xs font-bold"><strong className="text-xl text-teal">{totalCount}</strong> 棟租賃實登</div>
        <span className="text-[10.5px] text-ink-soft">{rentals.length < totalCount ? `顯示最近 ${rentals.length} 棟` : "依最近登錄排序"}</span>
      </div>
      <div className={resultScroll}>
        {rentals.length === 0 && <EmptyState title="沒有符合的租賃紀錄" hint="可改用地址或行政區搜尋。" />}
        {rentals.map((r) => (
          <article className="relative flex border-b border-[#e7ebe8] last:border-b-0" key={r.key}>
            <button className="group w-full border-0 bg-transparent px-2 py-3.5 text-left" onClick={() => onOpen(r)}>
              <div className="flex items-center gap-2">
                <strong className="truncate text-sm transition-colors duration-150 group-hover:text-teal">{r.name ?? r.address}</strong>
                <DistrictBadge>{r.district}</DistrictBadge>
              </div>
              {r.name && <div className="mt-[5px] truncate text-[10px] text-ink-soft">{r.address}</div>}
              <div className="mt-2 flex items-baseline gap-2.5">
                <b className="num text-[17px] text-ink">{r.monthlyRent.toLocaleString()} 元／月</b>
                <span className="num text-[11px] text-ink-soft">{r.rentPerPing.toLocaleString()} 元／坪</span>
              </div>
              <div className={resultFacts}>
                <span>屋齡 {r.age} 年</span>
                <span>{r.area} 坪</span>
                <span>{r.deals} 筆登錄</span>
                {r.lastDeal && <span>{r.lastDeal}</span>}
              </div>
            </button>
          </article>
        ))}
      </div>
    </aside>
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
          <EmptyState large title="還沒有比較名單" hint="在列表或建案詳情按下星號，最多加入三個建案。" />
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
