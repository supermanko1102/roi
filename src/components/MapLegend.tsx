import { LINE_COLOR } from "@/lib/map-colors";
import { ROOM_LABEL, type RoomFilter } from "@/lib/rooms";
import { CITIES } from "@/lib/cities";
import type { MarketMode } from "./product-kit";
import type { PillMode } from "@/lib/map-types";
import { cn } from "@/lib/utils";

const PILL_MODES: { key: PillMode; label: string; title: string }[] = [
  { key: "price", label: "一坪價", title: "成交單價（萬／坪）" },
  { key: "dev", label: "跟附近比", title: "比同生活圈其他預售案貴或便宜幾 %" },
  { key: "yield", label: "租金回報", title: "年租金 ÷ 總價" },
];

const noteCls = "mt-[5px] text-[9px] leading-normal text-ink-soft empty:hidden";

// 左下圖例：說明數字口徑與目前篩選；價格不再映射成行政區色階。
export default function MapLegend({ market, rooms, nearMetro, nearIC, detail, showStations,
  pillMode, setPillMode, shifted }: {
  market: MarketMode; rooms: RoomFilter; nearMetro: boolean; nearIC: boolean;
  detail: boolean; showStations: boolean;
  pillMode: PillMode; setPillMode: (m: PillMode) => void;
  shifted: boolean;               // 桌機清單攤開時往右讓位
}) {
  const presale = market === "presale";
  return (
    <div className={cn(
      "absolute bottom-6 left-4 z-10 w-[224px] rounded-[11px] border border-line bg-surface/94 px-3 py-2.5 shadow-[0_4px_15px_rgba(18,47,40,.10)] transition-[left] duration-180 max-mob:bottom-[118px] max-mob:left-2 max-mob:w-[196px] max-mob:py-2",
      shifted && "min-[721px]:left-[376px]",
    )}>
      {presale && (
        <div className="mb-2 flex rounded-[9px] bg-secondary p-[3px]" role="group" aria-label="建案標籤顯示的數字">
          {PILL_MODES.map(({ key, label, title }) => (
            <button key={key} type="button" title={title} aria-pressed={pillMode === key}
              onClick={() => setPillMode(key)}
              className="h-7 flex-1 rounded-[7px] border-0 bg-transparent px-1 text-[10.5px] font-bold text-[#53625d] aria-pressed:bg-white aria-pressed:text-teal aria-pressed:shadow-[0_1px_5px_rgba(7,60,53,.14)]">
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="mb-1.5 text-[10.5px] font-extrabold">
        {market === "rental" ? "標籤數字＝月租（元）"
          : pillMode === "dev" ? "標籤數字＝比附近貴(紅)／便宜(綠)"
          : pillMode === "yield" ? "標籤數字＝年租金 ÷ 總價"
          : "標籤數字＝成交單價（萬／坪）"}
      </div>
      {presale && pillMode === "dev" && (
        <div className={cn(noteCls, "max-mob:hidden")}>
          <b className="text-[#a23e2d]">紅＝比較貴</b>・<b className="text-teal">綠＝比較便宜</b>・±3% 內不上色。
          只比近一年成交，對照同生活圈其他案（不足改用行政區）；「—」＝樣本不夠，不硬比。放大到建案層才看得到。
        </div>
      )}
      {presale && pillMode === "yield" && (
        <div className={cn(noteCls, "max-mob:hidden")}>
          以本社區或附近 1 公里屋齡 1–10 年實際租約換算，未扣稅費、管理費與空置；「—」＝附近租約不足。
        </div>
      )}
      <div className={noteCls}>
        {[
          "行政區僅顯示邊界，不依房價著色",
          market === "rental" ? "棕「租」＝市場租賃(屋齡 1–10 年,同社區歸戶)・綠「社」＝社宅包租代管(不列入行情)" : null,
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
