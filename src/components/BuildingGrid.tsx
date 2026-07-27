"use client";
import { useEffect, useMemo, useState } from "react";
import { CircleParking, X } from "lucide-react";
import { fmtP } from "./drawer-kit";
import {
  Dialog, DialogClose, DialogContent, DialogTitle,
} from "@/components/ui/dialog";
import { getParkingInfo, type DealParkingFields } from "@/lib/deal-parking";

type GDeal = {
  deal_date: string | null; total_price: number | null; area_ping: number | null;
  unit_price: number | null; rooms: number | null; baths: number | null;
  parking_count: number | null; parking_type: string | null;
  parking_price: number | null; parking_area_ping: number | null;
  floor_no: number | null; unit_id: string | null;
  is_cancelled: boolean | null; cancel_date: string | null;
};

// 全形轉半形（棟及號常混用 ０-９、Ａ-Ｚ、－ 等全形字元）
function toHalfWidth(s: string): string {
  return s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

// 從「棟及號」解析出棟別與垂直戶別（stack）。
// 樓層資訊本身不從這裡取（已有 floor_no 欄位），只需把樓層 token 拿掉，
// 剩餘部分即為戶別，例如 A01-06F號→(棟"", 戶A01)、B棟6-9F號→(棟B, 戶6)、A棟14F-A號→(棟A, 戶A)。
export function parseStack(raw: string | null): { building: string; stack: string } | null {
  if (!raw) return null;
  let s = toHalfWidth(raw).trim().replace(/號$/, "");
  // 去掉最後一個樓層 token：可帶前導 - / ，多樓層以 . 、 相連（如 1.2.3F）
  s = s.replace(/[-/]?\d+(?:[.、]\d+)*F(?=[^F]*$)/i, "");
  const m = s.match(/^(.*?)棟/);
  const building = m ? `${m[1]}棟` : "";
  let stack = m ? s.slice(m[0].length) : s;
  stack = stack.replace(/^[-/.、]+|[-/.、]+$/g, "").trim();
  if (!building && !stack) return null;
  return { building, stack };
}

const rocDate = (iso: string | null) => {
  if (!iso) return "";
  const [y, m] = iso.split("-");
  return `${+y - 1911}/${m}`;
};

// 單價深淺（同一建案共用色階）：淡沙色 → 深綠，越貴越深
function cellColor(t: number): { bg: string; dark: boolean } {
  const l = 93 - t * 58;            // lightness 93% → 35%
  const sat = 18 + t * 26;          // 稍微增豔避免深色端變灰
  return { bg: `hsl(168 ${sat}% ${l}%)`, dark: l < 58 };
}

export type GResale = {
  deal_date: string | null; floor_no: number | null; rooms: number | null; baths: number | null;
  total_price: number | null; unit_price: number | null; area_ping: number | null;
  parking_count: number | null; parking_type: string | null;
  parking_price: number | null; parking_area_ping: number | null;
  addr?: string | null; is_store?: boolean;
};

export type UnitDoor = { unit_id: string | null; addr: string | null; n: number };

type Cell = {
  deal: GDeal; deals: GDeal[]; extra: number; onlyCancelled: boolean; resales: GResale[];
  resaleOnly?: boolean; // 預售未揭露、僅由門牌對照掛上轉售的戶
};

function hasParking(deal: DealParkingFields) {
  return getParkingInfo(deal).included;
}

function ParkingSummary({ deal }: { deal: DealParkingFields }) {
  const parking = getParkingInfo(deal);
  const label = parking.included
    ? parking.count != null ? `含 ${parking.count} 個車位` : "含車位"
    : parking.known ? "本筆無車位" : "車位資料未登錄";
  const detail = parking.included
    ? [parking.type, parking.area > 0 ? `${fmtP(parking.area)} 坪` : null].filter(Boolean).join("・")
      || "有登錄車位，未提供類型與坪數"
    : parking.known ? "交易筆棟數明確登錄為 0" : "舊資料尚未保存車位數，不能判定為無車位";

  return (
    <div className={`mt-3 grid grid-cols-[30px_1fr_auto] items-center gap-2.5 rounded-[11px] border px-3 py-2.5 ${
      parking.included ? "border-[#e5cf9f] bg-[#fff8eb]" : "border-line bg-[#f5f7f5]"
    }`}>
      <span className={`grid size-[30px] place-items-center rounded-full ${
        parking.included ? "bg-[#f1dfb8] text-[#7d581a]" : "bg-[#e4e9e6] text-ink-soft"
      }`} aria-hidden="true">
        <CircleParking className="size-4" strokeWidth={1.8} />
      </span>
      <span className="min-w-0">
        <b className="block text-[11px] text-ink">{label}</b>
        <small className="mt-0.5 block text-[9px] leading-[1.35] text-ink-soft">
          {detail}
        </small>
      </span>
      <span className="text-right">
        <small className="block text-[8.5px] text-ink-soft">車位總價</small>
        <b className="num mt-0.5 block text-[12px] text-ink">
          {parking.included ? parking.price > 0 ? `${fmtP(parking.price)} 萬` : "未拆分" : "—"}
        </b>
      </span>
    </div>
  );
}

function PriceFacts({ deal }: {
  deal: Pick<GDeal, "total_price" | "unit_price" | "parking_count" | "parking_type" | "parking_price" | "parking_area_ping">;
}) {
  const included = hasParking(deal);
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <div className="rounded-[10px] border border-line bg-white px-3 py-2.5">
        <span className="block text-[8.5px] text-ink-soft">成交總價{included ? "（含車位）" : ""}</span>
        <b className="num mt-1 block text-[16px] tracking-[-.03em] text-ink">
          {deal.total_price == null ? "—" : `${Math.round(Number(deal.total_price)).toLocaleString()} 萬`}
        </b>
      </div>
      <div className="rounded-[10px] border border-line bg-white px-3 py-2.5">
        <span className="block text-[8.5px] text-ink-soft">房屋單價{included ? "（已扣車位）" : ""}</span>
        <b className="num mt-1 block text-[16px] tracking-[-.03em] text-ink">
          {deal.unit_price == null ? "—" : `${fmtP(Number(deal.unit_price))} 萬/坪`}
        </b>
      </div>
    </div>
  );
}

export default function BuildingGrid({ deals, resales = [], unitDoors = [] }: {
  deals: GDeal[]; resales?: GResale[]; unitDoors?: UnitDoor[];
}) {
  const [sel, setSel] = useState<{ grid: string; stack: string; floor: number } | null>(null);
  useEffect(() => { setSel(null); }, [deals]);

  const model = useMemo(() => {
    const parsed = deals
      .map((d) => ({ d, key: parseStack(d.unit_id) }))
      .filter((x): x is { d: GDeal; key: { building: string; stack: string } } =>
        x.key != null && x.d.floor_no != null);
    const unplaced = deals.length - parsed.length;

    const prices = parsed.filter((x) => !x.d.is_cancelled && x.d.unit_price != null)
      .map((x) => Number(x.d.unit_price)).sort((a, b) => a - b);
    // p10–p90 夾住色階，避免單一極端戶把整片洗淡
    const lo = prices.length ? prices[Math.floor(prices.length * 0.1)] : 0;
    const hi = prices.length ? prices[Math.min(prices.length - 1, Math.floor(prices.length * 0.9))] : 1;

    const byBuilding = new Map<string, Map<string, Map<number, GDeal[]>>>();
    for (const { d, key } of parsed) {
      const b = byBuilding.get(key.building) ?? new Map();
      byBuilding.set(key.building, b);
      const st = b.get(key.stack || "—") ?? new Map();
      b.set(key.stack || "—", st);
      const arr = st.get(d.floor_no!) ?? [];
      st.set(d.floor_no!, arr);
      arr.push(d);
    }

    const cmp = new Intl.Collator("zh-Hant", { numeric: true }).compare;
    const buildings = [...byBuilding.entries()].sort((a, b) => cmp(a[0], b[0])).map(([bname, stacksMap]) => {
      const stacks = [...stacksMap.keys()].sort(cmp);
      const floors = [...new Set([...stacksMap.values()].flatMap((st) => [...st.keys()]))].sort((a, b) => b - a);
      const cells = new Map<string, Cell>();
      for (const [stack, byFloor] of stacksMap) {
        for (const [floor, arr] of byFloor) {
          const byDate = [...arr].sort((a, b) => +new Date(b.deal_date ?? 0) - +new Date(a.deal_date ?? 0));
          const active = byDate.filter((d) => !d.is_cancelled);
          const deal = active[0] ?? byDate[0];
          cells.set(`${stack}|${floor}`, { deal, deals: byDate, extra: arr.length - 1, onlyCancelled: active.length === 0, resales: [] });
        }
      }
      return { name: bname, stacks, floors, cells, colsAreBuildings: false };
    });

    // 「棟」本身就是垂直戶別的建案（A1棟、A2棟…每棟一直排）：
    // 合併成單一矩陣，欄＝棟，避免拆成數十張單欄小表
    let grids = buildings;
    if (buildings.length > 1 && buildings.every((b) => b.stacks.length === 1)) {
      const cells = new Map<string, Cell>();
      const cols: string[] = [];
      const floorSet = new Set<number>();
      for (const b of buildings) {
        const col = b.name.replace(/棟$/, "") || b.name;
        cols.push(col);
        for (const [k, v] of b.cells) {
          const floor = k.split("|")[1];
          cells.set(`${col}|${floor}`, v);
          floorSet.add(+floor);
        }
      }
      grids = [{ name: "", stacks: cols.sort(cmp), floors: [...floorSet].sort((a, b) => b - a), cells, colsAreBuildings: true }];
    }

    // 門牌→戶別線對照:交屋移轉時同筆預售交易會在 a 檔以門牌再揭露,
    // API 已 join 出 (棟戶代號, 門牌) 錨點;此處按門牌多數決決定每個門牌屬於哪條垂直戶別線。
    // 同一條線可能因季別格式不同出現兩種代號(「A1」與「A棟1」),候選保留排序後逐一嘗試。
    // 同一條戶別線會因季別格式不同出現兩種代號(「B2-7F號」與「B棟2-7F號」),
    // 投票以去「棟」字的正規化代號分組,原始 line 保留供逐一嘗試定位。
    const doorVotes = new Map<string, Map<string, { n: number; lines: Map<string, number> }>>();
    for (const u of unitDoors) {
      const key = parseStack(u.unit_id);
      if (!key || !u.addr) continue;
      const line = `${key.building}|${key.stack || "—"}`;
      const canon = `${key.building.replace(/棟$/, "")}${key.stack}`;
      const byCanon = doorVotes.get(u.addr) ?? new Map<string, { n: number; lines: Map<string, number> }>();
      doorVotes.set(u.addr, byCanon);
      const entry = byCanon.get(canon) ?? { n: 0, lines: new Map<string, number>() };
      byCanon.set(canon, entry);
      entry.n += u.n;
      entry.lines.set(line, (entry.lines.get(line) ?? 0) + u.n);
    }
    const doorLines = new Map<string, string[]>();
    for (const [addr, byCanon] of doorVotes) {
      const ranked = [...byCanon.values()].sort((a, b) => b.n - a.n);
      // 唯一候選 1 票即採用(同指紋唯一命中的信心);有競爭者時榜首需 2 票且 2 倍優勢
      // (同日同價雙胞胎交易會產生跨門牌雜訊票,多數決壓掉)
      if (ranked.length > 1 && !(ranked[0].n >= 2 && ranked[0].n >= ranked[1].n * 2)) continue;
      doorLines.set(addr, [...ranked[0].lines.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l));
    }
    const locate = (line: string) => {
      const [building, stack] = line.split("|");
      if (grids[0]?.colsAreBuildings) {
        const col = building.replace(/棟$/, "") || building;
        return grids[0].stacks.includes(col) ? { grid: grids[0], col } : null;
      }
      const g = grids.find((x) => x.name === building);
      return g ? { grid: g, col: stack } : null;
    };
    // 店面預售以獨立代號(S13 等)申報,門牌線多數決會被同門牌的住宅線壓過,不走門牌歸位
    const placeByDoor = (r: GResale): boolean => {
      if (!r.addr || r.floor_no == null || r.is_store) return false;
      const lines = doorLines.get(r.addr);
      if (!lines) return false;
      for (const line of lines) {
        const loc = locate(line);
        const cell = loc?.grid.cells.get(`${loc.col}|${r.floor_no}`);
        if (cell) { cell.resales.push(r); return true; }
      }
      // 該樓層預售未揭露:在票數最高的戶別線開「僅轉售」格
      for (const line of lines) {
        const loc = locate(line);
        if (!loc) continue;
        const synth: GDeal = { ...r, unit_id: null, is_cancelled: false, cancel_date: null };
        loc.grid.cells.set(`${loc.col}|${r.floor_no}`, {
          deal: synth, deals: [], extra: 0, onlyCancelled: false, resales: [r], resaleOnly: true,
        });
        if (!loc.grid.stacks.includes(loc.col)) { loc.grid.stacks.push(loc.col); loc.grid.stacks.sort(cmp); }
        if (!loc.grid.floors.includes(r.floor_no)) {
          loc.grid.floors.push(r.floor_no);
          loc.grid.floors.sort((a, b) => b - a);
        }
        return true;
      }
      return false;
    };

    // 歸位順序:門牌對照優先;沒有對照的退回「樓層＋權狀坪數」指紋
    // (同層唯一命中才放進格子),再不行收進 loose 列表,不硬猜。
    const loose: GResale[] = [];
    for (const r of resales) {
      if (placeByDoor(r)) continue;
      if (r.floor_no == null || r.area_ping == null) { loose.push(r); continue; }
      const matches = new Set<Cell>();
      for (const g of grids) {
        for (const [key, cell] of g.cells) {
          if (+key.split("|")[1] !== r.floor_no) continue;
          if (cell.deals.some((d) => d.area_ping != null
            && Math.abs(Number(d.area_ping) - Number(r.area_ping)) <= 0.5)) matches.add(cell);
        }
      }
      if (matches.size === 1) [...matches][0].resales.push(r);
      else loose.push(r);
    }
    for (const g of grids) for (const cell of g.cells.values()) {
      cell.resales.sort((a, b) => +new Date(b.deal_date ?? 0) - +new Date(a.deal_date ?? 0));
      // 僅轉售格的代表交易跟著排序後的最新一筆
      if (cell.resaleOnly && cell.resales.length)
        cell.deal = { ...cell.resales[0], unit_id: null, is_cancelled: false, cancel_date: null };
    }

    // 全案價差過小時（< 2 萬/坪）不上色，避免色階把微小差異視覺放大
    return { buildings: grids, unplaced, lo, hi, flat: hi - lo < 2, loose };
  }, [deals, resales, unitDoors]);

  if (!model.buildings.length) return <div className="grid-note">此建案的棟及號資料不足，無法繪製棟別圖。</div>;

  const { lo, hi, flat } = model;
  const t = (p: number) => hi > lo ? Math.min(1, Math.max(0, (p - lo) / (hi - lo))) : 0.5;
  const selected = sel == null ? null : (() => {
    const grid = model.buildings.find((building) => building.name === sel.grid);
    const cell = grid?.cells.get(`${sel.stack}|${sel.floor}`);
    if (!grid || !cell) return null;
    const unitLabel = grid.colsAreBuildings ? `${sel.stack}棟`
      : `${grid.name ? `${grid.name}　` : ""}${sel.stack !== "—" ? `${sel.stack}戶` : ""}`;
    return { cell, unitLabel };
  })();

  return (
    <div className="bgrid-wrap">
      <div className="bgrid-legend">
        <span>單價（萬/坪）</span>
        {flat ? (
          <span className="num">{fmtP(lo)} ～ {fmtP(hi)}・價差小，未上色</span>
        ) : (
          <>
            <i className="bgrid-ramp" aria-hidden />
            <span className="num">{fmtP(lo)} 低 ～ {fmtP(hi)} 高</span>
          </>
        )}
      </div>
      {model.buildings.map((b) => (
        <div key={b.name || "single"} className="bgrid-building">
          {(b.name || model.buildings.length > 1) && <div className="bgrid-bname">{b.name || "未分棟"}</div>}
          <div className="bgrid-scroll">
            <table className="bgrid num">
              <thead>
                <tr>
                  <th className="bgrid-floor" aria-label="樓層" />
                  {b.stacks.map((s) => <th key={s}>{s}</th>)}
                </tr>
              </thead>
              <tbody>
                {b.floors.map((f) => (
                  <tr key={f}>
                    <th className="bgrid-floor">{f}</th>
                    {b.stacks.map((s) => {
                      const cell = b.cells.get(`${s}|${f}`);
                      if (!cell) return <td key={s} className="bgrid-empty" />;
                      const { deal, extra, onlyCancelled, resaleOnly } = cell;
                      const price = deal.unit_price != null ? Number(deal.unit_price) : null;
                      // 僅轉售格不套預售色階:轉售單價普遍較高,染色會扭曲全案深淺對比
                      const c = price != null && !onlyCancelled && !resaleOnly
                        ? (flat ? { bg: "hsl(168 15% 90%)", dark: false } : cellColor(t(price)))
                        : null;
                      const selected = sel != null && sel.grid === b.name && sel.stack === s && sel.floor === f;
                      const unitLabel = b.colsAreBuildings ? `${s}棟` : s !== "—" ? `${s}戶` : "";
                      const rs = cell.resales;
                      const parking = getParkingInfo(deal);
                      const parkingLabel = parking.included
                        ? parking.count != null ? `含 ${parking.count} 個車位` : "含車位"
                        : parking.known ? "無車位" : "車位資料未登錄";
                      return (
                        <td key={s} role="button" tabIndex={0} aria-pressed={selected}
                          aria-label={`${unitLabel} ${f}樓，${resaleOnly ? "僅轉售揭露，" : ""}${price == null ? "無單價" : `單價 ${fmtP(price)} 萬`}，${parkingLabel}${onlyCancelled ? "，已解約" : ""}${rs.length ? `，交屋後轉售 ${rs.length} 筆` : ""}`}
                          className={`bgrid-cell${onlyCancelled ? " cancelled" : ""}${resaleOnly ? " rs-only" : ""}${c?.dark ? " deep" : ""}${selected ? " sel" : ""}`}
                          style={c ? { background: c.bg } : undefined}
                          onClick={() => setSel(selected ? null : { grid: b.name, stack: s, floor: f })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSel(selected ? null : { grid: b.name, stack: s, floor: f });
                            }
                          }}>
                          <span className="bgrid-date">{rocDate(deal.deal_date)}</span>
                          <b>{price == null ? "—" : fmtP(price)}</b>
                          {extra > 0 && <i className="bgrid-extra" aria-label={`${extra} 筆其他紀錄`} />}
                          {rs.length > 0 && <i className="bgrid-rs" aria-hidden />}
                          {parking.included && <i className="bgrid-park" aria-hidden>車</i>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div className="grid-note">
        {flat ? "" : "深色＝單價較高。"}空格＝尚無揭露。車＝含車位。虛線框＝已解約。橘角＝交屋後轉售。虛線橘框＝僅轉售揭露戶。點格子可看該戶詳情。
        {model.unplaced > 0 && `另有 ${model.unplaced} 筆缺樓層或戶別資訊，僅列於「列表」。`}
      </div>
      {model.loose.length > 0 && (
        <details className="bgrid-loose" open>
          <summary>其他轉售（{model.loose.length} 筆，無法對應戶別）</summary>
          <table className="bgrid-loose-table num">
            <tbody>
              {model.loose.map((r, i) => (
                <tr key={i}>
                  <td>{r.deal_date ?? "—"}</td>
                  <td>
                    {r.addr ?? "門牌未知"}
                    {r.floor_no != null ? `・${r.floor_no}樓` : ""}
                    {r.is_store ? "・店面" : r.rooms != null ? `・${r.rooms}房` : ""}
                  </td>
                  <td>{r.total_price == null ? "—" : `${Math.round(Number(r.total_price)).toLocaleString()} 萬`}</td>
                  <td>{r.unit_price == null ? "—" : `${fmtP(Number(r.unit_price))} 萬`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <Dialog open={selected != null} onOpenChange={(open) => { if (!open) setSel(null); }}>
        {selected && sel && (
          <DialogContent showCloseButton={false}
            overlayClassName="z-70 bg-[#081c18]/42 supports-backdrop-filter:backdrop-blur-[2px]"
            className="z-70 block max-h-[min(680px,calc(100dvh-32px))] w-[min(410px,calc(100vw-28px))] max-w-none gap-0 overflow-y-auto rounded-[18px] bg-surface p-0 shadow-[0_26px_80px_rgba(7,38,32,.3)] ring-0 sm:max-w-none"
            onKeyDown={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-surface px-5 py-4">
              <div className="min-w-0">
                <span className="text-[9px] font-extrabold tracking-[.16em] text-teal">成交明細</span>
                <DialogTitle className="mt-1 font-display text-[21px] font-bold leading-tight text-ink">
                  {selected.unitLabel}　{sel.floor} 樓
                </DialogTitle>
                <span className="num mt-1 block text-[9.5px] text-ink-soft">
                  {selected.cell.deals.length > 0 && `${selected.cell.deals.length} 筆預售紀錄`}
                  {selected.cell.resales.length > 0 &&
                    `${selected.cell.deals.length > 0 ? "・" : ""}${selected.cell.resales.length} 筆交屋後轉售`}
                </span>
              </div>
              <DialogClose aria-label="關閉成交明細"
                className="grid size-8 flex-none place-items-center rounded-full border-0 bg-muted text-ink-soft">
                <X className="size-3.5" />
              </DialogClose>
            </div>

            <div className="space-y-3 p-4">
              {selected.cell.deals.map((deal, index) => (
                <article key={index} className={`rounded-[14px] border bg-[#fbfcfa] p-3 ${
                  deal.is_cancelled ? "border-dashed border-[#d89082]" : "border-line"
                }`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="num text-[11px] text-ink">{deal.deal_date ?? "日期未登錄"}</b>
                    {index === 0 && !deal.is_cancelled && (
                      <span className="rounded-full bg-mint px-2 py-0.5 text-[8.5px] font-extrabold text-teal">最新揭露</span>
                    )}
                    {deal.is_cancelled && (
                      <span className="rounded-full bg-[#fae9e5] px-2 py-0.5 text-[8.5px] font-extrabold text-coral">
                        已解約{deal.cancel_date ? `・${deal.cancel_date}` : ""}
                      </span>
                    )}
                    <span className="ml-auto text-[9px] text-ink-soft">
                      {[deal.rooms != null ? `${deal.rooms}房${deal.baths != null ? `${deal.baths}衛` : ""}` : null,
                        deal.area_ping != null ? `權狀 ${fmtP(Number(deal.area_ping))} 坪` : null]
                        .filter(Boolean).join("・") || "規格未登錄"}
                    </span>
                  </div>
                  <PriceFacts deal={deal} />
                  <ParkingSummary deal={deal} />
                </article>
              ))}

              {selected.cell.resales.map((deal, index) => (
                <article key={`resale-${index}`} className="rounded-[14px] border border-[#e5cf9f] bg-[#fffdf8] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[#f4e4c5] px-2 py-0.5 text-[8.5px] font-extrabold text-[#815a1a]">
                      {deal.is_store ? "店面轉售" : "交屋後轉售"}
                    </span>
                    <b className="num text-[11px] text-ink">{deal.deal_date ?? "日期未登錄"}</b>
                    <span className="ml-auto text-[9px] text-ink-soft">
                      {[deal.addr ?? null,
                        deal.rooms != null ? `${deal.rooms}房${deal.baths != null ? `${deal.baths}衛` : ""}` : null,
                        deal.area_ping != null ? `權狀 ${fmtP(Number(deal.area_ping))} 坪` : null]
                        .filter(Boolean).join("・") || "規格未登錄"}
                    </span>
                  </div>
                  <PriceFacts deal={deal} />
                  <ParkingSummary deal={deal} />
                </article>
              ))}
            </div>
            {[...selected.cell.deals, ...selected.cell.resales].some((deal) =>
              hasParking(deal) && Number(deal.parking_price ?? 0) <= 0) && (
              <p className="border-t border-line px-5 py-3 text-[8.5px] leading-[1.5] text-ink-soft">
                「未拆分」代表成交含車位，但申報資料未單獨列出車位價格，並非車位免費。
              </p>
            )}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
