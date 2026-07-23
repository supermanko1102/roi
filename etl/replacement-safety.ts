export function assertReplacementSafe(
  label: string, previousCount: number, nextCount: number, allowEmpty = false,
) {
  if (allowEmpty) return;
  if (nextCount <= 0)
    throw new Error(`${label} 新資料為 0 筆；拒絕覆蓋，可用 --allow-empty 明確允許`);
  if (previousCount > 0 && nextCount < previousCount * 0.7)
    throw new Error(`${label} 從 ${previousCount} 降至 ${nextCount}（跌幅超過 30%）；拒絕覆蓋`);
}
