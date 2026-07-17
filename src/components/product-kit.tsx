import type { ReactNode } from "react";
import type { RoomFilter } from "@/lib/rooms";

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
    <header className="product-head">
      <div className="brand-block">
        <div className="brand-mark" aria-hidden="true">R</div>
        <div>
          <div className="brand-name">桃園預售・租屋</div>
          <div className="brand-tagline">預售成交與租賃實價登錄</div>
        </div>
      </div>
      <div className="market-switch" role="group" aria-label="資料類型">
        <button className={market === "presale" ? "on" : ""} aria-pressed={market === "presale"}
          onClick={() => setMarket("presale")}>預售屋</button>
        <button className={market === "rental" ? "on" : ""} aria-pressed={market === "rental"}
          onClick={() => setMarket("rental")}>租屋</button>
      </div>
      <label className="searchbox">
        <span aria-hidden="true">⌕</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={market === "presale" ? "搜尋建案、行政區" : "搜尋社區、地址、行政區"}
          aria-label={market === "presale" ? "搜尋建案或行政區" : "搜尋租屋社區、地址或行政區"} />
        {query && <button onClick={() => setQuery("")} aria-label="清除搜尋">×</button>}
      </label>
      <div className={`head-actions ${market === "rental" ? "rental" : ""}`}>
        <div className="view-switch" role="group" aria-label="檢視模式">
          <button className={view === "map" ? "on" : ""} aria-pressed={view === "map"}
            onClick={() => setView("map")}>地圖</button>
          <button className={view === "list" ? "on" : ""} aria-pressed={view === "list"}
            onClick={() => setView("list")}>列表</button>
        </div>
        {market === "presale" && <button className={`head-button ${filtersOpen ? "on" : ""}`} aria-pressed={filtersOpen}
          onClick={() => setFiltersOpen(!filtersOpen)}>篩選{activeFilters ? ` ${activeFilters}` : ""}</button>}
        {market === "presale" && <button className="head-button" onClick={openCompare}>比較 {savedCount}/3</button>}
        <button className="head-button share-button" onClick={share}>{shared ? "已複製" : "分享"}</button>
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
    <section className={`filter-panel ${open ? "open" : ""}`} aria-label="建案篩選">
      <div className="filter-head"><strong>縮小選房範圍</strong><button onClick={reset}>全部清除</button></div>
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
  return <div className="filter-group"><span>{label}</span><div>{children}</div></div>;
}

function FilterButton({ on, onClick, tone, children }: {
  on: boolean; onClick: () => void; tone?: "risk"; children: ReactNode;
}) {
  return <button className={`${on ? "on" : ""} ${tone === "risk" ? "risk" : ""}`}
    aria-pressed={on} onClick={onClick}>{children}</button>;
}

export function ResultsPanel({ open, projects, totalCount, saved, onOpen, onToggleSaved }: {
  open: boolean; projects: ProjectSummary[]; totalCount: number; saved: ProjectSummary[];
  onOpen: (p: ProjectSummary) => void; onToggleSaved: (p: ProjectSummary) => void;
}) {
  const savedKeys = new Set(saved.map((p) => p.key));
  return (
    <aside className={`results-panel ${open ? "open" : ""}`} aria-label="建案列表">
      <div className="results-head">
        <div><strong>{totalCount}</strong> 個符合建案</div>
        <span>依建案名稱排序</span>
      </div>
      <div className="result-scroll">
        {projects.length === 0 && <div className="empty-state"><b>沒有符合條件的建案</b><span>試著放寬總價、房型或交通條件。</span></div>}
        {projects.map((p) => (
          <article className="result-card" key={p.key}>
            <button className="result-main" onClick={() => onOpen(p)}>
              <div className="result-title"><strong>{p.name}</strong><span>{p.district}</span></div>
              <div className="result-price"><b className="num">{money(p.total)}</b><span>{price(p.price)}</span></div>
              <div className="result-facts">
                {p.area != null && <span>{Math.round(p.area)} 坪</span>}
                <span>{p.deals} 筆成交</span>
                {walk(p.stationM) != null && <span>步行 {walk(p.stationM)} 分</span>}
              </div>
            </button>
            <button className={`save-button ${savedKeys.has(p.key) ? "on" : ""}`}
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
    <aside className={`results-panel ${open ? "open" : ""}`} aria-label="租屋列表">
      <div className="results-head">
        <div><strong>{totalCount}</strong> 棟租賃實登</div>
        <span>{rentals.length < totalCount ? `顯示最近 ${rentals.length} 棟` : "依最近登錄排序"}</span>
      </div>
      <div className="result-scroll">
        {rentals.length === 0 && <div className="empty-state"><b>沒有符合的租賃紀錄</b><span>可改用地址或行政區搜尋。</span></div>}
        {rentals.map((r) => (
          <article className="result-card" key={r.key}>
            <button className="result-main rental-result" onClick={() => onOpen(r)}>
              <div className="result-title"><strong>{r.name ?? r.address}</strong><span>{r.district}</span></div>
              {r.name && <div className="result-address">{r.address}</div>}
              <div className="result-price">
                <b className="num">{r.monthlyRent.toLocaleString()} 元／月</b>
                <span className="num">{r.rentPerPing.toLocaleString()} 元／坪</span>
              </div>
              <div className="result-facts">
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

export function ComparePanel({ open, saved, onClose, onRemove, onOpen }: {
  open: boolean; saved: ProjectSummary[]; onClose: () => void;
  onRemove: (p: ProjectSummary) => void; onOpen: (p: ProjectSummary) => void;
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="compare-panel" role="dialog" aria-modal="true" aria-labelledby="compare-title">
        <div className="modal-head">
          <div><span className="eyebrow">SHORTLIST</span><h2 id="compare-title">建案比較</h2></div>
          <button onClick={onClose} aria-label="關閉比較">×</button>
        </div>
        {saved.length === 0 ? (
          <div className="empty-state large"><b>還沒有比較名單</b><span>在列表或建案詳情按下星號，最多加入三個建案。</span></div>
        ) : (
          <div className="compare-grid">
            {saved.map((p) => (
              <article className="compare-card" key={p.key}>
                <button className="remove-compare" onClick={() => onRemove(p)} aria-label={`移除${p.name}`}>×</button>
                <span className="compare-district">{p.district}</span>
                <h3>{p.name}</h3>
                <button className="compare-link" onClick={() => onOpen(p)}>查看成交紀錄 →</button>
                <CompareRow label="成交總價" value={money(p.total)} />
                <CompareRow label="單價" value={price(p.price)} />
                <CompareRow label="坪數" value={p.area == null ? "—" : `${Math.round(p.area)} 坪`} />
                <CompareRow label="成交樣本" value={`${p.deals} 筆`} />
                <CompareRow label="最近車站" value={walk(p.stationM) == null ? "—" : `${walk(p.stationM)} 分`} />
                <CompareRow label="解約紀錄" value={p.cancels ? `${p.cancels} 筆` : "未見紀錄"} />
              </article>
            ))}
            {Array.from({ length: 3 - saved.length }).map((_, i) => (
              <div className="compare-empty" key={i}>還可加入一個建案</div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CompareRow({ label, value }: { label: string; value: string }) {
  return <div className="compare-row"><span>{label}</span><b className="num">{value}</b></div>;
}
