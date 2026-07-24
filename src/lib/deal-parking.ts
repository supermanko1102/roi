export type DealParkingFields = {
  parking_count?: number | null;
  parking_type?: string | null;
  parking_price: number | null;
  parking_area_ping: number | null;
};

export type ParkingInfo = {
  included: boolean;
  known: boolean;
  count: number | null;
  type: string | null;
  price: number;
  area: number;
};

export function getParkingInfo(deal: DealParkingFields): ParkingInfo {
  const rawCount = deal.parking_count;
  const count = rawCount != null && Number.isInteger(Number(rawCount)) && Number(rawCount) >= 0
    ? Number(rawCount)
    : null;
  const price = Math.max(0, Number(deal.parking_price ?? 0));
  const area = Math.max(0, Number(deal.parking_area_ping ?? 0));
  const type = deal.parking_type?.trim() || null;
  const known = count != null;

  return {
    included: known ? count > 0 : price > 0 || area > 0 || type != null,
    known,
    count,
    type,
    price,
    area,
  };
}
