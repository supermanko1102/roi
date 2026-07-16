import { DEV_STOPS, PRICE_STOPS, LINE_COLOR, type ColorMode } from "@/lib/map-colors";
import { ROOM_LABEL, type RoomFilter } from "@/lib/rooms";

// 左下圖例:色階說明 + 目前篩選的白話註記
export default function MapLegend({ mode, rooms, nearMetro, nearIC, detail, showStations }: {
  mode: ColorMode; rooms: RoomFilter; nearMetro: boolean; nearIC: boolean;
  detail: boolean; showStations: boolean;
}) {
  const stops = mode === "rel" ? DEV_STOPS : PRICE_STOPS;
  return (
    <div className="legend">
      <div className="ltitle">
        {mode === "rel" ? "預售案和附近行情相比" : "預售一坪價格(萬)"}
      </div>
      <div className="lgrad" style={{
        background: `linear-gradient(to right, ${stops.map((s) => s[1]).join(",")})`,
      }} />
      <div className="lticks">
        {mode === "rel"
          ? <><span>便宜 15%</span><span>差不多</span><span>貴 15%</span></>
          : <><span>$20</span><span>$32</span><span>$44</span></>}
      </div>
      <div className="lnote">
        {[
          mode === "rel" ? "色塊=跟全市比・圓點=跟它所在的生活圈比" : null,
          detail ? "○ 預售中 ● 已完工建案" : null,
          rooms !== "all" ? `只計 ${ROOM_LABEL[rooms]} 的成交` : null,
          nearMetro ? "只顯示步行 10 分內有站的建案" : null,
          nearIC ? "只顯示 2 公里內有交流道的建案" : null,
        ].filter(Boolean).join("・")}
      </div>
      {detail && showStations && (
        <div className="lnote">
          <span style={{ color: LINE_COLOR["機場捷運"] }}>●</span> 機捷{" "}
          <span style={{ color: LINE_COLOR["台鐵"] }}>●</span> 台鐵{" "}
          <span style={{ color: LINE_COLOR["桃園捷運綠線"] }}>○</span> 綠線(施工中){" "}
          <span style={{ color: "#37474f" }}>◆</span> 交流道
        </div>
      )}
    </div>
  );
}
