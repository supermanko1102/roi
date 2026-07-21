"use client";
import { useMemo } from "react";
import { fmtP } from "./drawer-kit";

type GDeal = {
  deal_date: string | null; total_price: number | null; area_ping: number | null;
  unit_price: number | null; rooms: number | null;
  floor_no: number | null; unit_id: string | null;
  is_cancelled: boolean | null;
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

type Cell = { deal: GDeal; extra: number; onlyCancelled: boolean };

export default function BuildingGrid({ deals }: { deals: GDeal[] }) {
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
          const active = arr.filter((d) => !d.is_cancelled)
            .sort((a, b) => +new Date(b.deal_date ?? 0) - +new Date(a.deal_date ?? 0));
          const deal = active[0] ?? arr[0];
          cells.set(`${stack}|${floor}`, { deal, extra: arr.length - 1, onlyCancelled: active.length === 0 });
        }
      }
      return { name: bname, stacks, floors, cells };
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
      grids = [{ name: "", stacks: cols.sort(cmp), floors: [...floorSet].sort((a, b) => b - a), cells }];
    }

    return { buildings: grids, unplaced, lo, hi };
  }, [deals]);

  if (!model.buildings.length) return <div className="grid-note">此建案的棟及號資料不足，無法繪製棟別圖。</div>;

  const { lo, hi } = model;
  const t = (p: number) => hi > lo ? Math.min(1, Math.max(0, (p - lo) / (hi - lo))) : 0.5;

  return (
    <div className="bgrid-wrap">
      <div className="bgrid-legend">
        <span>單價（萬/坪）</span>
        <i className="bgrid-ramp" aria-hidden />
        <span className="num">{fmtP(lo)} 低 ～ {fmtP(hi)} 高</span>
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
                      const { deal, extra, onlyCancelled } = cell;
                      const price = deal.unit_price != null ? Number(deal.unit_price) : null;
                      const c = price != null && !onlyCancelled ? cellColor(t(price)) : null;
                      const tip = [
                        deal.deal_date, `${f}樓 ${s !== "—" ? `${s}戶` : ""}`,
                        deal.rooms != null ? `${deal.rooms}房` : null,
                        deal.area_ping != null ? `${fmtP(Number(deal.area_ping))}坪` : null,
                        deal.total_price != null ? `總價 ${Math.round(Number(deal.total_price)).toLocaleString()}萬` : null,
                        onlyCancelled ? "已解約" : null,
                        extra > 0 ? `另有 ${extra} 筆紀錄` : null,
                      ].filter(Boolean).join("・");
                      return (
                        <td key={s}
                          className={`bgrid-cell${onlyCancelled ? " cancelled" : ""}${c?.dark ? " dark" : ""}`}
                          style={c ? { background: c.bg } : undefined}
                          title={tip}>
                          <span className="bgrid-date">{rocDate(deal.deal_date)}</span>
                          <b>{price == null ? "—" : fmtP(price)}</b>
                          {extra > 0 && <i className="bgrid-extra" aria-label={`${extra} 筆其他紀錄`} />}
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
        深色＝單價較高。空格＝尚無揭露。虛線框＝已解約。
        {model.unplaced > 0 && `另有 ${model.unplaced} 筆缺樓層或戶別資訊，僅列於「列表」。`}
      </div>
    </div>
  );
}
