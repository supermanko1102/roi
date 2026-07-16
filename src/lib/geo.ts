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
