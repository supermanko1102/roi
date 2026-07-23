// 純 JS 點在多邊形內判斷(Polygon/MultiPolygon 含挖洞)。
// 點位僅數千、多邊形數十個,先過 bbox 再 ray casting 就夠快,不動用 PostGIS。

export type Ring = [number, number][];

export function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

export function inGeom(lng: number, lat: number, geom: any): boolean {
  const polys: Ring[][] = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  for (const rings of polys) {
    if (!inRing(lng, lat, rings[0])) continue;
    if (!rings.slice(1).some((h) => inRing(lng, lat, h))) return true;
  }
  return false;
}

// Polygon/MultiPolygon 的外框(標籤定位、fitBounds 用;遞迴走座標,不管深度)
export function geomBbox(geom: any): [number, number, number, number] {
  let w = 180, s = 90, e = -180, n = -90;
  const walk = (c: any) => {
    if (typeof c[0] === "number") {
      if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
    } else for (const x of c) walk(x);
  };
  walk(geom.coordinates);
  return [w, s, e, n];
}

// 兩點球面距離(公尺):算「最近車站」夠準了
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 點到 Polygon/MultiPolygon 邊界的最短距離；圈內為 0。
// 生活圈是小範圍平面，將經緯度投影成局部公尺座標後算線段距離即可。
export function distanceToGeomM(lat: number, lng: number, geom: any): number {
  if (inGeom(lng, lat, geom)) return 0;
  const polys: Ring[][] = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  const metersPerLng = 111_320 * Math.cos(lat * Math.PI / 180);
  let closest = Infinity;
  for (const rings of polys) for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = (ring[j][0] - lng) * metersPerLng;
      const ay = (ring[j][1] - lat) * 111_320;
      const bx = (ring[i][0] - lng) * metersPerLng;
      const by = (ring[i][1] - lat) * 111_320;
      const dx = bx - ax, dy = by - ay;
      const length2 = dx * dx + dy * dy;
      const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2));
      closest = Math.min(closest, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return closest;
}

// 直線距離換步行分鐘(路網迂迴係數 1.3、80m/分),下限 1 分
export const walkMinutes = (m: number) => Math.max(1, Math.round(m * 1.3 / 80));

// 預先算 bbox 的 contains,批次判斷大量點時用
export function makeContains(geom: any) {
  const polys: Ring[][] = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let w = 180, e = -180, s = 90, n = -90;
  for (const rings of polys) for (const [x, y] of rings[0]) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return (lng: number, lat: number): boolean => {
    if (lng < w || lng > e || lat < s || lat > n) return false;
    for (const rings of polys) {
      if (!inRing(lng, lat, rings[0])) continue;
      let hole = false;
      for (let i = 1; i < rings.length; i++) if (inRing(lng, lat, rings[i])) { hole = true; break; }
      if (!hole) return true;
    }
    return false;
  };
}
