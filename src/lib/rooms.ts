// 房數帶:格局篩選的統一定義(0房套房歸入 1)
export const ROOM_BANDS = ["1", "2", "3", "4p"] as const;
export type RoomBand = (typeof ROOM_BANDS)[number];
export type RoomFilter = "all" | RoomBand;

export const ROOM_LABEL: Record<RoomFilter, string> = {
  all: "全格局", "1": "1房", "2": "2房", "3": "3房", "4p": "4房+",
};
