import { LINE_COLOR } from "@/lib/map-colors";
import { ROOM_LABEL, type RoomFilter } from "@/lib/rooms";
import { CITIES } from "@/lib/cities";
import type { MarketMode } from "./product-kit";

const noteCls = "mt-[5px] text-[9px] leading-normal text-ink-soft empty:hidden";

// 左下圖例：說明數字口徑與目前篩選；價格不再映射成行政區色階。
export default function MapLegend({ market, rooms, nearMetro, nearIC, detail, showStations }: {
  market: MarketMode; rooms: RoomFilter; nearMetro: boolean; nearIC: boolean;
  detail: boolean; showStations: boolean;
}) {
  return (
    <div className="pointer-events-none absolute bottom-6 left-4 z-10 w-[212px] rounded-[11px] border border-line bg-surface/94 px-3 py-2.5 shadow-[0_4px_15px_rgba(18,47,40,.10)] max-mob:bottom-[76px] max-mob:left-2 max-mob:w-[180px]">
      <div className="mb-1.5 text-[10.5px] font-extrabold">
        {market === "rental" ? "標籤數字＝月租（元）" : "標籤數字＝成交單價（萬／坪）"}
      </div>
      <div className={noteCls}>
        {[
          "行政區僅顯示邊界，不依房價著色",
          market === "rental" ? "棕色「租」＝屋齡 1–10 年、非社宅租賃實登" : null,
          market === "presale" && rooms !== "all" ? `只計 ${ROOM_LABEL[rooms]} 的成交` : null,
          market === "presale" && nearMetro ? "只顯示步行 10 分內有站的建案" : null,
          market === "presale" && nearIC ? "只顯示 2 公里內有交流道的建案" : null,
        ].filter(Boolean).join("・")}
      </div>
      {detail && showStations && (CITIES.length > 1 ? (
        // 多城市線太多逐條列不下:通用說明,顏色跟站點小圓點一致
        <div className={noteCls}>● 車站(依路線色) ○ 施工中路線 <span style={{ color: "#37474f" }}>◆</span> 交流道</div>
      ) : (
        <div className={noteCls}>
          <span style={{ color: LINE_COLOR["機場捷運"] }}>●</span> 機捷{" "}
          <span style={{ color: LINE_COLOR["台鐵"] }}>●</span> 台鐵{" "}
          <span style={{ color: LINE_COLOR["桃園捷運綠線"] }}>○</span> 綠線(施工中){" "}
          <span style={{ color: "#37474f" }}>◆</span> 交流道
        </div>
      ))}
    </div>
  );
}
