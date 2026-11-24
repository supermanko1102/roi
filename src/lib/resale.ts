// 交屋後轉售的認定(純運算)。
// a 檔(成屋買賣)在交屋後會湧入大量「建商把房子過戶給預售買方」的紀錄:
// 成交日寫的是過戶時間,價格卻是幾年前簽預售約時談定的,並不是當下的轉手行情。
// 實測 2021 年後完工的案:交屋後 30 個月內,「該戶第一次過戶」的單價比同案真正轉手低 10–20%,
// 之後才收斂。因此這段期間只把「同一戶先前已有過戶紀錄」的成交算成轉售。
// 更久以後的首筆紀錄(老社區的首次過戶早於資料涵蓋期、地主戶首次出售)照常算轉售。

/** 交屋後多久內,該戶的第一筆過戶視為建商交屋而非轉售 */
export const FIRST_HAND_WINDOW_MONTHS = 30;

function addMonths(iso: string, months: number): Date {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/**
 * 是否為建商交屋過戶(第一手),不該當成轉售行情。
 * @param hasPrior 同一戶(完整門牌含樓層戶號)在這筆之前是否已有買賣紀錄
 */
export function isFirstHandTransfer(dealDate: string | null, completedAt: string, hasPrior: boolean): boolean {
  if (hasPrior || !dealDate) return false;
  return new Date(dealDate) <= addMonths(completedAt, FIRST_HAND_WINDOW_MONTHS);
}
