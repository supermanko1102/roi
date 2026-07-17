// 成交單價顯示：整數不帶小數，其餘保留一位。
export const fmtP = (v: number) => (Math.round(v * 10) / 10).toString();
