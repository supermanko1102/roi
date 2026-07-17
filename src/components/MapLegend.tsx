import { LINE_COLOR } from "@/lib/map-colors";
import { ROOM_LABEL, type RoomFilter } from "@/lib/rooms";
import type { MarketMode } from "./product-kit";

// 左下圖例：說明數字口徑與目前篩選；價格不再映射成行政區色階。
export default function MapLegend({ market, rooms, nearMetro, nearIC, detail, showStations }: {
  market: MarketMode; rooms: RoomFilter; nearMetro: boolean; nearIC: boolean;
  detail: boolean; showStations: boolean;
}) {
  return (
    <div className="legend">
      <div className="ltitle">
        {market === "rental" ? "標籤數字＝月租（元）" : "標籤數字＝成交單價（萬／坪）"}
      </div>
      <div className="lnote">
        {[
          "行政區僅顯示邊界，不依房價著色",
          market === "rental" ? "棕色「租」＝屋齡 1–10 年、非社宅租賃實登" : null,
          market === "presale" && detail ? "○ 預售中 ● 已完工建案" : null,
          market === "presale" && rooms !== "all" ? `只計 ${ROOM_LABEL[rooms]} 的成交` : null,
          market === "presale" && nearMetro ? "只顯示步行 10 分內有站的建案" : null,
          market === "presale" && nearIC ? "只顯示 2 公里內有交流道的建案" : null,
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
