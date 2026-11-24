import { Popup } from "react-map-gl/maplibre";
import { walkMinutes } from "@/lib/geo";
import { SHOW_IC_M, SHOW_STATION_M } from "@/lib/map-const";
import type { PresalePopupData, RentalPopupData } from "@/lib/map-types";
import { DevBadge } from "./product-kit";

// 點地圖上的建案/租賃點跳出的摘要卡;「看更多」交給 PropertyMap 開抽屜。

export function PresalePopup({ popup, onClose, onOpen }: {
  popup: PresalePopupData; onClose: () => void; onOpen: () => void;
}) {
  return (
    <Popup longitude={popup.lng} latitude={popup.lat} anchor="bottom"
      onClose={onClose} closeButton maxWidth="280px" offset={14}>
      <div className="popup-card">
        <h3>{popup.name}</h3>
        <div style={{ color: "var(--ink-soft)", fontSize: 11 }}>
          {popup.district}
          ・{popup.band === "presale" ? "預售"
            : popup.build_year ? `${new Date().getFullYear() - popup.build_year} 年屋(已完工)` : "已完工"}
          ・{popup.deal_count} 筆成交
        </div>
        <div className="roi">
          <b className="num">{popup.price == null ? "—" : popup.price.toFixed(1)}</b>
          <span>一坪約(萬,已扣車位)</span>
        </div>
        <dl>
          <div><dt>一戶大約</dt><dd className="num">
            {popup.median_total == null ? "—" : (+popup.median_total).toLocaleString() + " 萬"}</dd></div>
          <div><dt>坪數大約</dt><dd className="num">
            {popup.median_area == null ? "—" : (+popup.median_area).toFixed(0) + " 坪"}</dd></div>
        </dl>
        {((popup.st_m != null && popup.st_m <= SHOW_STATION_M) ||
          (popup.ic_m != null && popup.ic_m <= SHOW_IC_M)) && (
          <div className="note" style={{ borderTop: "none", marginTop: 5, paddingTop: 0 }}>
            {popup.st_name && popup.st_m != null && popup.st_m <= SHOW_STATION_M &&
              <>🚉 {popup.st_name}({popup.st_line})步行約 {walkMinutes(popup.st_m)} 分<br /></>}
            {popup.ic_name && popup.ic_m != null && popup.ic_m <= SHOW_IC_M &&
              <>🛣️ {popup.ic_name}約 {(popup.ic_m / 1000).toFixed(1)} 公里</>}
          </div>
        )}
        {(popup.dev != null || popup.yield_pct != null) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <DevBadge dev={popup.dev} base={popup.dev_base} />
            {popup.yield_pct != null && (
              <span className="num rounded-full border border-line bg-white px-[7px] py-[2px] text-[10px] font-bold text-ink">
                租金回報 {popup.yield_pct.toFixed(1)}%
              </span>
            )}
          </div>
        )}
        {popup.cancel_count > 0 && (
          <div className="cancelnote">⚠ 本案曾有 {popup.cancel_count} 筆解約(未計入價格統計)</div>
        )}
        <button className="detailbtn"
          onClick={onOpen}>
          查看基本資料與成交紀錄 →
        </button>
      </div>
    </Popup>
  );
}

export function RentalPopup({ popup, onClose, onOpen }: {
  popup: RentalPopupData; onClose: () => void; onOpen: () => void;
}) {
  return (
    <Popup longitude={popup.lng} latitude={popup.lat} anchor="bottom"
      onClose={onClose} closeButton maxWidth="300px" offset={16}>
      <div className="popup-card rental-popup">
        <div className="rental-kicker">
          {popup.is_social ? "社會住宅包租代管" : "租賃實價登錄"}・屋齡 {popup.age} 年
        </div>
        <h3>{popup.name ?? `${popup.building_type}出租住宅`}</h3>
        <div className="rental-address">
          {popup.address}{popup.doors > 1 ? `(社區共 ${popup.doors} 個門牌)` : ""}
        </div>
        <div className="rental-price">
          <b className="num">{popup.monthly_rent.toLocaleString()}</b><span>元／月</span>
        </div>
        <dl>
          <div><dt>每坪月租</dt><dd className="num">{popup.rent_per_ping.toLocaleString()} 元</dd></div>
          <div><dt>租賃坪數</dt><dd className="num">約 {popup.area_ping} 坪</dd></div>
          {popup.parking_rent != null && <div><dt>其中車位</dt><dd className="num">{popup.parking_rent.toLocaleString()} 元</dd></div>}
          <div><dt>實登樣本</dt><dd className="num">{popup.deal_count} 筆</dd></div>
          <div><dt>最近租約</dt><dd className="num">{popup.last_deal ?? "—"}</dd></div>
        </dl>
        <div className="rental-trust">
          {popup.is_social
            ? "社宅包租代管件中位數・租金非市場行情,不列入行情統計"
            : `同${popup.doors > 1 ? "社區" : "門牌"}租約中位數`
              + (popup.social_count > 0 ? `・另有社宅 ${popup.social_count} 筆未計入` : "")
              + "・不代表目前仍在招租"}
        </div>
        <button className="detailbtn" onClick={onOpen}>
          查看歷史租約明細 →
        </button>
      </div>
    </Popup>
  );
}
