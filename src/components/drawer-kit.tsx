// 成交單價顯示：整數不帶小數，其餘保留一位。
export const fmtP = (v: number) => (Math.round(v * 10) / 10).toString();

// 建案/租賃抽屜共用的明細表頭樣式與小元件
export const dealsTh = "border-b border-line px-1.5 py-[5px] text-left text-[9.5px] font-bold text-ink-soft";

export function shortRocDate(iso: string | null): string {
  if (!iso) return "—";
  const [year, month, day] = iso.split("-");
  return `${Number(year) - 1911}/${month}/${day}`;
}

export function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-[#e4e8e5] bg-white p-2.5">
      <span className="mb-1 block text-[9px] text-ink-soft">{label}</span>
      <b className="num block text-[11px] font-bold wrap-anywhere">{value == null || value === "" ? "—" : value}</b>
    </div>
  );
}

export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** 租約明細列(租賃抽屜與建案抽屜「本社區租約」共用) */
export type RLease = {
  deal_date: string | null; addr: string | null;
  floor_no: number | null; total_floors: number | null;
  area_ping: number | null; rooms: number | null; halls: number | null;
  rental_type: string | null; building_type: string | null; build_year: number | null;
  monthly_rent: number | null; housing_rent: number | null;
  parking_rent: number | null; rent_per_ping: number | null;
  is_social: boolean | null;
};

export function LeaseTable({ rows, cap }: { rows: RLease[]; cap: number }) {
  return (
    <>
      <div className="mt-2 overflow-x-auto rounded-[10px] border border-line">
        <table className="num w-full table-fixed border-collapse text-[10.5px]">
          <colgroup>
            <col className="w-[82px] max-mob:w-[72px]" />
            <col />
            <col className="w-[92px] max-mob:w-[80px]" />
            <col className="w-[96px] max-mob:w-[86px]" />
          </colgroup>
          <thead>
            <tr>
              <th className={dealsTh}>日期</th>
              <th className={dealsTh}>門牌・樓層</th>
              <th className={dealsTh}>格局・坪數</th>
              <th className={dealsTh}>月租</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, cap).map((l, i) => (
              <tr key={i} className="align-top even:bg-[#f5f7f4]">
                <td className="whitespace-nowrap p-1.5">
                  <span className="max-mob:hidden">{l.deal_date ?? "—"}</span>
                  <span className="hidden max-mob:inline">{shortRocDate(l.deal_date)}</span>
                </td>
                <td className="p-1.5">
                  <b className="block font-extrabold text-ink wrap-anywhere">{l.addr ?? "門牌未登錄"}</b>
                  <small className="mt-0.5 block text-[8.5px] text-ink-soft">
                    {[l.floor_no != null ? `${l.floor_no}樓${l.total_floors ? `/${l.total_floors}` : ""}` : null,
                      l.rental_type].filter(Boolean).join("・") || "樓層未登錄"}
                  </small>
                </td>
                <td className="whitespace-nowrap p-1.5">
                  {l.rooms != null && l.rooms > 0 ? `${l.rooms}房${l.halls ? `${l.halls}廳` : ""}` : "—"}
                  <small className="mt-0.5 block text-[8.5px] text-ink-soft">
                    {l.area_ping == null ? "坪數 —" : `${(+l.area_ping).toFixed(1)} 坪`}
                  </small>
                </td>
                <td className="whitespace-nowrap p-1.5">
                  <b className="block font-bold text-ink">
                    {l.monthly_rent == null ? "—" : `${Math.round(l.monthly_rent).toLocaleString()} 元`}
                  </b>
                  <small className="mt-0.5 block text-[8.5px] text-ink-soft">
                    {l.rent_per_ping == null ? "每坪 —" : `每坪 ${Math.round(l.rent_per_ping).toLocaleString()} 元`}
                    {l.parking_rent != null && l.parking_rent > 0 ? `・含車位 ${Math.round(l.parking_rent).toLocaleString()}` : ""}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > cap && <div className="mt-[7px] text-right text-[9px] text-ink-soft">顯示最近 {cap} 筆</div>}
    </>
  );
}
