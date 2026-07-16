"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Map, { Source, Layer, Marker, Popup, MapRef } from "react-map-gl/maplibre";
import type { FeatureCollection } from "geojson";
import BuildingDrawer from "./BuildingDrawer";
import ProjectDrawer from "./ProjectDrawer";
import { AGE_BANDS, BAND_LABEL, type BandFilter } from "@/lib/age";
import { ROOM_BANDS, ROOM_LABEL, type RoomFilter } from "@/lib/rooms";
import { makeContains } from "@/lib/geo";
import "maplibre-gl/dist/maplibre-gl.css";

// 屋齡帶單選是唯一的市場篩選:預售只是屋齡軸最左端,不再有預售/中古雙軌
const FILTERS: BandFilter[] = ["all", ...AGE_BANDS];

type BldgDeal = {
  address: string; deal_date: string | null;
  total_price: string; area_ping: string; unit_price: string | null;
};
type BldgPopup = {
  lng: number; lat: number;
  addr_key: string; deal_count: number; median_unit_price: number | null;
  building_type: string | null; build_year: number | null;
  community: string | null; // 社區歸戶名稱(2021 後備查建案才有)
  deals: BldgDeal[] | null; // null = 載入中
};
type PresalePopup = {
  lng: number; lat: number;
  name: string; district: string; deal_count: number;
  price: number | null; median_total: number | null; median_area: number | null;
  band: string; build_year: number | null;
  cancel_count: number;
};

// CARTO Positron 淺色底圖:極簡資料視覺化風格,CDN 快(NLSC 官方圖磚較慢且視覺雜訊多)
const BASE_STYLE: any = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    carto: {
      type: "raster",
      tiles: ["a", "b", "c", "d"].map(
        (s) => `https://${s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png`),
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors © CARTO・區界 © 內政部/g0v",
    },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
};

// 樂居式層級切換:zoom 過門檻自動浮出點位,行政區色塊同步淡出
const DETAIL_ZOOM = 12;
// 重劃區/生活圈層:DETAIL_ZOOM ~ ZONE_FADE 之間顯示,更放大就淡出讓位給點位
const ZONE_FADE = 13.9;

const PRICE_STOPS: [number, string][] = [[20, "#e2ebf5"], [32, "#7aa7cf"], [44, "#184a7c"]];
// 相對行情發散色階(%):紅=比同屋齡帶行情貴、綠=便宜(沿用台灣紅漲綠跌慣例)
const DEV_STOPS: [number, string][] = [[-15, "#1a7f5c"], [0, "#ece7dd"], [15, "#c2452d"]];

type ColorMode = "rel" | "abs";

const priceProp = (band: BandFilter) => `price_${band}`;
const devProp = (band: BandFilter) => `dev_${band}`;

// 區/圈色塊:rel=偏離全市同帶中位 %;abs=所選帶中位單價;無資料灰
function fillExpr(band: BandFilter, mode: ColorMode): any {
  const prop = mode === "rel" ? devProp(band) : priceProp(band);
  const stops = mode === "rel" ? DEV_STOPS : PRICE_STOPS;
  return [
    "case",
    ["==", ["get", prop], null], "#cfd6da",
    ["interpolate", ["linear"], ["get", prop], ...stops.flat()],
  ];
}
const PRICE_INTERP: any = ["interpolate", ["linear"], ["get", "price"], ...PRICE_STOPS.flat()];
const DEV_INTERP: any = ["interpolate", ["linear"], ["get", "dev"], ...DEV_STOPS.flat()];
function rampColor(stops: [number, string][], v: number | null): string {
  const s = stops;
  if (v == null) return "#9aa5ad";
  if (v <= s[0][0]) return s[0][1];
  if (v >= s[2][0]) return s[2][1];
  return v < s[1][0] ? mix(s[0], s[1], v) : mix(s[1], s[2], v);
}
const priceColor = (v: number | null) => rampColor(PRICE_STOPS, v);
const devColor = (v: number | null) => rampColor(DEV_STOPS, v);
// 發散色階兩端深色配白字、中段淺色配深字
const devTextColor = (v: number | null) => (v != null && Math.abs(v) >= 7 ? "#fff" : "#43390f");
const fmtDev = (v: number | null, digits = 1) =>
  v == null ? null : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;

// API 回應的 city(全市各帶基準)→ 每個 feature 補 dev_<band>(%)
function augmentDev(geo: any) {
  const city = geo.city ?? {};
  for (const f of geo.features) {
    for (const key of ["all", ...AGE_BANDS]) {
      const base = city[`price_${key}`], v = f.properties[`price_${key}`];
      f.properties[`dev_${key}`] =
        base > 0 && v != null ? +((v / base - 1) * 100).toFixed(1) : null;
    }
  }
  return geo;
}
function mix(a: [number, string], b: [number, string], v: number): string {
  const t = (v - a[0]) / (b[0] - a[0]);
  const pa = hex(a[1]), pb = hex(b[1]);
  return `rgb(${pa.map((x, i) => Math.round(x + (pb[i] - x) * t)).join(",")})`;
}
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export default function PropertyMap() {
  const mapRef = useRef<MapRef>(null);
  const [districts, setDistricts] = useState<FeatureCollection | null>(null);
  const [band, setBand] = useState<BandFilter>("all");
  const [mode, setMode] = useState<ColorMode>("rel");
  const [rooms, setRooms] = useState<RoomFilter>("all");
  const [showCancel, setShowCancel] = useState(false);
  const [zoom, setZoom] = useState(10.3);
  const [points, setPoints] = useState<FeatureCollection | null>(null);
  const [bldgPopup, setBldgPopup] = useState<BldgPopup | null>(null);
  const [presalePopup, setPresalePopup] = useState<PresalePopup | null>(null);
  const [zones, setZones] = useState<FeatureCollection | null>(null);
  const [drawerAddr, setDrawerAddr] = useState<string | null>(null);
  const [drawerProj, setDrawerProj] = useState<{ district: string; name: string } | null>(null);
  const detail = zoom >= DETAIL_ZOOM;
  const zoneLevel = zoom >= DETAIL_ZOOM && zoom < ZONE_FADE;

  useEffect(() => {
    fetch("/api/districts").then((r) => r.json()).then((g) => setDistricts(augmentDev(g)));
    fetch("/api/zones").then((r) => r.json()).then((g) => setZones(augmentDev(g)));
    // 深連結:?bldg=門牌 / ?proj=區|建案名 直接開抽屜(可分享)
    const q = new URLSearchParams(location.search);
    const b = q.get("bldg");
    if (b) setDrawerAddr(b);
    const pj = q.get("proj");
    if (pj && pj.includes("|")) {
      const [district, ...rest] = pj.split("|");
      setDrawerProj({ district, name: rest.join("|") });
    }
  }, []);

  // 抽屜開關同步到網址,重整/分享都能還原;兩種抽屜互斥
  function syncUrl(set: Record<string, string | null>) {
    const u = new URL(location.href);
    for (const [k, v] of Object.entries(set)) v == null ? u.searchParams.delete(k) : u.searchParams.set(k, v);
    history.replaceState(null, "", u);
  }
  function openDrawer(addr: string) {
    setDrawerAddr(addr); setDrawerProj(null); setBldgPopup(null);
    syncUrl({ bldg: addr, proj: null });
  }
  function closeDrawer() {
    setDrawerAddr(null);
    syncUrl({ bldg: null });
  }
  function openProjDrawer(district: string, name: string) {
    setDrawerProj({ district, name }); setDrawerAddr(null); setPresalePopup(null);
    syncUrl({ proj: `${district}|${name}`, bldg: null });
  }
  function closeProjDrawer() {
    setDrawerProj(null);
    syncUrl({ proj: null });
  }

  useEffect(() => {
    if (!detail) { setBldgPopup(null); setPresalePopup(null); }
  }, [detail]);

  // 切帶:cluster source 換資料重算;開著的 popup 可能已不在帶內,直接收
  function pickBand(b: BandFilter) {
    setBand(b); setBldgPopup(null); setPresalePopup(null);
  }
  // 切格局:點位口徑整個換掉,清快取重抓目前視窗
  function pickRooms(r: RoomFilter) {
    setRooms(r); setBldgPopup(null); setPresalePopup(null);
    fetchedBbox.current = null;
    const map = mapRef.current?.getMap();
    if (map && map.getZoom() >= DETAIL_ZOOM) {
      const b = map.getBounds();
      loadDetail([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], r);
    }
  }

  // 生活圈索引:算每個點位「vs 所在圈同屋齡帶中位」的偏離用
  const zoneIndex = useMemo(
    () => (zones ? zones.features.map((f: any) => ({ contains: makeContains(f.geometry), props: f.properties })) : []),
    [zones]);
  // 注意:全域 Map 被 react-map-gl 的 <Map> 遮蔽,這裡用普通物件
  const distProps = useMemo(() => {
    const m: Record<string, any> = {};
    for (const f of (districts?.features ?? []) as any[]) m[f.properties.name] = f.properties;
    return m;
  }, [districts]);

  // 帶過濾在前端做:cluster 聚合發生在 source 層,layer filter 濾不掉 cluster 內容。
  // 同時替每個點補 dev(%):基準=所在生活圈同帶中位,圈外退回行政區同帶中位
  const visiblePoints = useMemo(() => {
    if (!points) return null;
    const feats = (points.features as any[])
      .filter((f) => band === "all" || f.properties.band === band)
      .map((f) => {
        const p = f.properties;
        const key = !p.band || p.band === "unknown" ? "all" : p.band;
        const [lng, lat] = f.geometry.coordinates;
        let base: number | null = null;
        for (const z of zoneIndex) if (z.contains(lng, lat)) { base = z.props[`price_${key}`] ?? null; break; }
        if (base == null) base = distProps[p.district]?.[`price_${key}`] ?? null;
        const dev = base && p.price != null ? +((p.price / base - 1) * 100).toFixed(1) : null;
        return { ...f, properties: { ...p, dev, dev_label: fmtDev(dev, 0) ?? "" } };
      });
    return { ...points, features: feats };
  }, [points, band, zoneIndex, distProps]);

  // 解約標記:獨立於屋齡帶篩選,永遠拿全部點位過濾
  const cancelPoints = useMemo(() => {
    if (!points) return null;
    return { ...points, features: (points.features as any[]).filter((f) => (f.properties.cancel_count ?? 0) > 0) };
  }, [points]);

  const labels = useMemo(() => {
    if (!districts) return [];
    return districts.features.map((f: any) => {
      // 標籤放邊界框中心(粗略但夠用;更準可預算 pole of inaccessibility)
      const flat = JSON.stringify(f.geometry.coordinates).match(/\[(-?[\d.]+),(-?[\d.]+)\]/g) ?? [];
      let minX = 180, maxX = 0, minY = 90, maxY = 0;
      for (const pt of flat) {
        const [x, y] = pt.slice(1, -1).split(",").map(Number);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      return { name: f.properties.name, lng: (minX + maxX) / 2, lat: (minY + maxY) / 2, props: f.properties };
    });
  }, [districts]);

  // 重劃區標籤放邊界框中心(邊界是官方圖資的 Polygon/MultiPolygon)
  const zoneLabels = useMemo(() => {
    if (!zones) return [];
    return zones.features.map((f: any) => {
      const pos: [number, number][] = f.geometry.type === "Polygon"
        ? f.geometry.coordinates.flat() : f.geometry.coordinates.flat(2);
      const xs = pos.map((p) => p[0]), ys = pos.map((p) => p[1]);
      return {
        name: f.properties.name,
        lng: (Math.min(...xs) + Math.max(...xs)) / 2,
        lat: (Math.min(...ys) + Math.max(...ys)) / 2,
        bounds: [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]] as [[number, number], [number, number]],
        props: f.properties,
      };
    });
  }, [zones]);

  function zoomToZone(name: string) {
    const z = zoneLabels.find((l) => l.name === name);
    if (!z) return;
    loadDetail([z.bounds[0][0], z.bounds[0][1], z.bounds[1][0], z.bounds[1][1]]); // 與飛行動畫並行抓資料
    mapRef.current?.fitBounds(z.bounds, { padding: 40, duration: 600 });
  }

  // 視窗載入:zoom 進入細節層級後按目前視窗(外擴 40%)抓統一點位;
  // 新視窗仍在上次抓過的範圍內就不重抓
  const fetchedBbox = useRef<[number, number, number, number] | null>(null);
  async function loadDetail(view: [number, number, number, number], roomsOverride?: RoomFilter) {
    const fb = fetchedBbox.current;
    if (fb && view[0] >= fb[0] && view[1] >= fb[1] && view[2] <= fb[2] && view[3] <= fb[3]) return;
    const padX = (view[2] - view[0]) * 0.4, padY = (view[3] - view[1]) * 0.4;
    const bbox = [view[0] - padX, view[1] - padY, view[2] + padX, view[3] + padY]
      .map((v) => +v.toFixed(5)) as [number, number, number, number];
    fetchedBbox.current = bbox;
    const rm = roomsOverride ?? rooms;
    const res = await fetch(`/api/points?bbox=${bbox.join(",")}${rm !== "all" ? `&rooms=${rm}` : ""}`);
    setPoints(await res.json());
  }

  // 點行政區 → 縮放到該區;顯示什麼由 zoom 門檻決定,與滾輪放大走同一條路
  function drill(name: string) {
    const feats = (districts?.features ?? []).find((f: any) => f.properties.name === name) as any;
    if (!feats) return;
    const flat = JSON.stringify(feats.geometry.coordinates).match(/\[(-?[\d.]+),(-?[\d.]+)\]/g) ?? [];
    let minX = 180, maxX = 0, minY = 90, maxY = 0;
    for (const pt of flat) {
      const [x, y] = pt.slice(1, -1).split(",").map(Number);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    loadDetail([minX, minY, maxX, maxY]); // 與飛行動畫並行抓資料,動畫結束即有點位
    // 面積大的區 fitBounds 後可能還不到細節門檻,保底跨過去
    const map = mapRef.current?.getMap();
    const cam = map?.cameraForBounds([[minX, minY], [maxX, maxY]], { padding: 60 });
    if (map && cam) map.easeTo({ ...cam, zoom: Math.max(cam.zoom ?? DETAIL_ZOOM, DETAIL_ZOOM + 0.1), duration: 700 });
  }
  function back() {
    mapRef.current?.flyTo({ center: [121.25, 24.94], zoom: 10.3, duration: 700 });
  }

  async function openBuilding(f: any) {
    const p = f.properties;
    const [lng, lat] = f.geometry.coordinates;
    setBldgPopup({
      lng, lat, addr_key: p.addr_key, deal_count: p.deal_count,
      median_unit_price: p.price ?? null,
      building_type: p.building_type ?? null, build_year: p.build_year ?? null,
      community: p.name ?? null,
      deals: null,
    });
    const res = await fetch(`/api/building-deals?addr=${encodeURIComponent(p.addr_key)}`);
    const deals = await res.json();
    setBldgPopup((cur) => (cur && cur.addr_key === p.addr_key ? { ...cur, deals } : cur));
  }

  function openPoint(f: any) {
    const p = f.properties;
    if (p.kind === "resale") {
      // 抽屜開著時點別棟直接切換內容,維持「掃描→查看→再掃描」的節奏
      if (drawerAddr || drawerProj) openDrawer(p.addr_key);
      else openBuilding(f);
      return;
    }
    if (drawerAddr || drawerProj) { openProjDrawer(p.district, p.name); return; }
    const [lng, lat] = f.geometry.coordinates;
    setPresalePopup({
      lng, lat, name: p.name, district: p.district, deal_count: p.deal_count,
      price: p.price ?? null, median_total: p.median_total ?? null,
      median_area: p.median_area ?? null, band: p.band, build_year: p.build_year ?? null,
      cancel_count: p.cancel_count ?? 0,
    });
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Map
        ref={mapRef}
        mapStyle={BASE_STYLE}
        initialViewState={{ longitude: 121.25, latitude: 24.94, zoom: 10.3 }}
        onLoad={(e) => e.target.resize()} // 容器尺寸就緒前 canvas 可能只畫一角
        onMove={(e) => {
          // 動畫/拖曳中只在跨越門檻時更新,避免每幀重繪 DOM markers
          const z = e.viewState.zoom;
          setZoom((prev) => ((prev >= DETAIL_ZOOM) !== (z >= DETAIL_ZOOM) ? z : prev));
        }}
        onMoveEnd={(e) => {
          setZoom(e.viewState.zoom);
          if (e.viewState.zoom >= DETAIL_ZOOM) {
            const b = e.target.getBounds();
            loadDetail([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
          }
        }}
        onClick={(e) => {
          const f = e.features?.[0];
          if (!f) return;
          if (f.layer.id === "pt-cluster") {
            // 點 cluster → 展開放大
            const src: any = mapRef.current?.getSource("points");
            src?.getClusterExpansionZoom(f.properties!.cluster_id).then((z: number) =>
              mapRef.current?.easeTo({ center: (f.geometry as any).coordinates, zoom: z + 0.5, duration: 500 }));
          } else if (f.layer.id === "pt-point") {
            openPoint(f);
          } else if (f.layer.id === "zone-fill") {
            zoomToZone((f.properties as any).name);
          } else if (!detail) {
            drill((f.properties as any).name);
          }
        }}
        interactiveLayerIds={detail
          ? (zoneLevel ? ["pt-cluster", "pt-point", "zone-fill"] : ["pt-cluster", "pt-point"])
          : ["district-fill"]}
      >
        {districts && (
          <Source id="districts" type="geojson" data={districts}>
            <Layer id="district-fill" type="fill"
              paint={{
                "fill-color": fillExpr(band, mode) as any,
                // 放大進細節層級時色塊淡出,只留區界
                "fill-opacity": ["interpolate", ["linear"], ["zoom"],
                  DETAIL_ZOOM - 0.6, 0.34, DETAIL_ZOOM + 0.8, 0.04] as any,
              }} />
            <Layer id="district-line" type="line"
              paint={{
                "line-color": "#2c5f8a",
                "line-width": ["interpolate", ["linear"], ["zoom"],
                  DETAIL_ZOOM - 0.6, 2, DETAIL_ZOOM + 0.8, 1] as any,
              }} />
          </Source>
        )}

        {zones && (
          <Source id="zones" type="geojson" data={zones}>
            <Layer id="zone-fill" type="fill"
              paint={{
                "fill-color": fillExpr(band, mode) as any,
                "fill-opacity": ["interpolate", ["linear"], ["zoom"],
                  DETAIL_ZOOM - 0.4, 0, DETAIL_ZOOM + 0.3, 0.22,
                  ZONE_FADE - 0.7, 0.22, ZONE_FADE, 0] as any,
              }} />
            <Layer id="zone-line" type="line"
              paint={{
                "line-color": "#8a5fb0", "line-width": 1.6, "line-dasharray": [2, 1.5],
                "line-opacity": ["interpolate", ["linear"], ["zoom"],
                  DETAIL_ZOOM - 0.4, 0, DETAIL_ZOOM + 0.3, 0.9,
                  ZONE_FADE - 0.7, 0.9, ZONE_FADE, 0] as any,
              }} />
          </Source>
        )}

        {detail && visiblePoints && (
          <Source id="points" type="geojson" data={visiblePoints}
            cluster clusterMaxZoom={15} clusterRadius={48}>
            <Layer id="pt-cluster" type="circle" filter={["has", "point_count"]}
              paint={{
                "circle-color": "#3d7ea6",
                "circle-opacity": 0.85,
                "circle-radius": ["step", ["get", "point_count"], 14, 20, 19, 100, 25],
                "circle-stroke-width": 2, "circle-stroke-color": "#fff",
              }} />
            <Layer id="pt-cluster-count" type="symbol" filter={["has", "point_count"]}
              layout={{
                "text-field": ["get", "point_count_abbreviated"],
                "text-font": ["Open Sans Semibold"], "text-size": 13,
              }}
              paint={{ "text-color": "#fff" }} />
            {/* 預售(未完工)空心圓、已完工實心圓;rel 模式以偏離%上色 */}
            <Layer id="pt-point" type="circle" filter={["!", ["has", "point_count"]]}
              paint={{
                "circle-color": [
                  "case",
                  ["==", ["get", "band"], "presale"], "#ffffff",
                  ["==", ["get", mode === "rel" ? "dev" : "price"], null], "#9aa5ad",
                  mode === "rel" ? DEV_INTERP : PRICE_INTERP,
                ] as any,
                "circle-stroke-color": [
                  "case",
                  ["!=", ["get", "band"], "presale"], "#ffffff",
                  ["==", ["get", mode === "rel" ? "dev" : "price"], null], "#9aa5ad",
                  mode === "rel" ? DEV_INTERP : PRICE_INTERP,
                ] as any,
                "circle-radius": 8,
                "circle-stroke-width": ["case", ["==", ["get", "band"], "presale"], 3, 2] as any,
              }} />
            <Layer id="pt-label" type="symbol" filter={["!", ["has", "point_count"]]}
              minzoom={15}
              layout={{
                // 有社區/建案名就一併顯示;rel=偏離%、abs=單價(格局篩選時改中位總價,找總價帶用)
                "text-field": (() => {
                  const val: any = mode === "rel" ? ["get", "dev_label"]
                    : rooms !== "all" ? ["concat", ["to-string", ["get", "median_total"]], "萬"]
                    : ["concat", "$", ["to-string", ["get", "price"]]];
                  return ["case", ["has", "name"], ["concat", ["get", "name"], "\n", val], val];
                })() as any,
                "text-font": ["Open Sans Semibold"], "text-size": 12,
                "text-offset": [0, 1.3], "text-anchor": "top",
                "text-optional": true,
              }}
              paint={{ "text-color": "#184a7c", "text-halo-color": "#fff", "text-halo-width": 1.6 }} />
          </Source>
        )}

        {/* 解約標記:紅圈壓在點位上,獨立於屋齡帶/格局篩選 */}
        {detail && showCancel && cancelPoints && (
          <Source id="cancels" type="geojson" data={cancelPoints}>
            <Layer id="cancel-halo" type="circle"
              paint={{
                "circle-color": "rgba(220,53,69,.12)",
                "circle-radius": ["+", 12, ["*", 2, ["get", "cancel_count"]]] as any,
                "circle-stroke-color": "#dc3545", "circle-stroke-width": 2,
              }} />
            <Layer id="cancel-label" type="symbol"
              layout={{
                "text-field": ["concat", ["get", "name"], "\n解約 ", ["to-string", ["get", "cancel_count"]], " 筆"] as any,
                "text-font": ["Open Sans Semibold"], "text-size": 11,
                "text-offset": [0, 1.6], "text-anchor": "top", "text-allow-overlap": true,
              }}
              paint={{ "text-color": "#b02a37", "text-halo-color": "#fff", "text-halo-width": 1.6 }} />
          </Source>
        )}

        {!detail && labels.map((l) => {
          const price = l.props[priceProp(band)], dev = l.props[devProp(band)];
          const rel = mode === "rel";
          const noData = (rel ? dev : price) == null;
          return (
            <Marker key={l.name} longitude={l.lng} latitude={l.lat} anchor="center">
              <div
                className={`dlabel ${noData ? "nodata" : ""}`}
                onClick={(e) => { e.stopPropagation(); drill(l.name); }}
                title={rel && dev != null ? `vs 全市同帶中位(中位 $${price ?? "—"})` : undefined}
              >
                <span className="dname">{l.name}</span>
                <span className="dval num"
                  style={rel && !noData ? { background: devColor(+dev), color: devTextColor(+dev) } : undefined}>
                  {noData ? "資料不足" : rel ? fmtDev(+dev) : `$${(+price).toFixed(1)}`}
                </span>
              </div>
            </Marker>
          );
        })}

        {zoneLevel && zoneLabels.map((l) => {
          const price = l.props[priceProp(band)], dev = l.props[devProp(band)];
          const rel = mode === "rel";
          const v = rel ? dev : price;
          return (
            <Marker key={l.name} longitude={l.lng} latitude={l.lat} anchor="center">
              <div className="zlabel" onClick={(e) => { e.stopPropagation(); zoomToZone(l.name); }}
                title={`${l.name}:${BAND_LABEL[band]} ${l.props[`n_${band}`] ?? 0} 筆成交${rel && price != null ? `・中位 $${(+price).toFixed(1)}` : ""}`}>
                <span className="zname">{l.name}</span>
                <span className="zval num"
                  style={rel && v != null ? { background: devColor(+v), color: devTextColor(+v) } : undefined}>
                  {v == null ? "—" : rel ? fmtDev(+v) : `$${(+v).toFixed(1)}`}
                </span>
              </div>
            </Marker>
          );
        })}

        {presalePopup && (
          <Popup longitude={presalePopup.lng} latitude={presalePopup.lat} anchor="bottom"
            onClose={() => setPresalePopup(null)} closeButton maxWidth="280px" offset={14}>
            <div className="popup-card">
              <h3>{presalePopup.name}</h3>
              <div style={{ color: "var(--ink-soft)", fontSize: 11 }}>
                {presalePopup.district}
                ・{presalePopup.band === "presale" ? "預售"
                  : presalePopup.build_year ? `${new Date().getFullYear() - presalePopup.build_year} 年屋(已完工)` : "已完工"}
                ・{presalePopup.deal_count} 筆成交
              </div>
              <div className="roi" style={{ background: priceColor(presalePopup.price) }}>
                <b className="num">{presalePopup.price == null ? "—" : presalePopup.price.toFixed(1)}</b>
                <span>扣車位單價(萬/坪)</span>
              </div>
              <dl>
                <div><dt>中位總價</dt><dd className="num">
                  {presalePopup.median_total == null ? "—" : (+presalePopup.median_total).toLocaleString() + " 萬"}</dd></div>
                <div><dt>中位坪數</dt><dd className="num">
                  {presalePopup.median_area == null ? "—" : (+presalePopup.median_area).toFixed(1) + " 坪"}</dd></div>
              </dl>
              {presalePopup.cancel_count > 0 && (
                <div className="cancelnote">⚠ 本案曾有 {presalePopup.cancel_count} 筆解約(未計入價格統計)</div>
              )}
              <button className="detailbtn"
                onClick={() => openProjDrawer(presalePopup.district, presalePopup.name)}>
                查看建案詳情(去化、格局、樓層)→
              </button>
            </div>
          </Popup>
        )}
        {bldgPopup && (
          <Popup longitude={bldgPopup.lng} latitude={bldgPopup.lat} anchor="bottom"
            onClose={() => setBldgPopup(null)} closeButton maxWidth="320px" offset={12}>
            <div className="popup-card">
              <h3>{bldgPopup.community ?? bldgPopup.addr_key.replace(/^桃園市[^區]+區/, "")}</h3>
              <div style={{ color: "var(--ink-soft)", fontSize: 11 }}>
                {bldgPopup.community ? `${bldgPopup.addr_key.replace(/^桃園市[^區]+區/, "")}・` : ""}
                {bldgPopup.building_type ?? "—"}
                {bldgPopup.build_year ? `・${new Date().getFullYear() - bldgPopup.build_year} 年屋` : ""}
                ・{bldgPopup.deal_count} 筆成交
              </div>
              <div className="roi" style={{ background: "#3d7ea6" }}>
                <b className="num">{bldgPopup.median_unit_price == null ? "—" : `${bldgPopup.median_unit_price.toFixed(1)}`}</b>
                <span>中位單價(萬/坪,扣車位)</span>
              </div>
              {bldgPopup.deals == null ? (
                <div className="note">載入成交明細…</div>
              ) : (
                <table className="deals num">
                  <thead><tr><th>日期</th><th>總價</th><th>單價</th></tr></thead>
                  <tbody>
                    {bldgPopup.deals.slice(0, 8).map((d, i) => (
                      <tr key={i}>
                        <td>{d.deal_date ? d.deal_date.slice(0, 10) : "—"}</td>
                        <td>{(+d.total_price).toLocaleString()} 萬</td>
                        <td>{d.unit_price ? (+d.unit_price).toFixed(1) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {bldgPopup.deals && bldgPopup.deals.length > 8 && (
                <div className="note">僅列最近 8 筆(共 {bldgPopup.deals.length} 筆)</div>
              )}
              <button className="detailbtn" onClick={() => openDrawer(bldgPopup.addr_key)}>
                查看詳情(走勢與全部成交)→
              </button>
            </div>
          </Popup>
        )}
      </Map>

      {drawerAddr && <BuildingDrawer addrKey={drawerAddr} zones={zones} onClose={closeDrawer} />}
      {drawerProj && <ProjectDrawer district={drawerProj.district} name={drawerProj.name}
        zones={zones} onClose={closeProjDrawer} />}

      <div id="topbar">
        <div className="tbrow">
          <span className="title">桃園房價地圖</span>
          <div className="toggle" role="group" title="上色:相對=偏離同屋齡帶行情的百分比;單價=中位單價">
            <button className={mode === "rel" ? "on" : ""} onClick={() => setMode("rel")}>相對行情</button>
            <button className={mode === "abs" ? "on" : ""} onClick={() => setMode("abs")}>單價</button>
          </div>
          <button className={`cancelbtn ${showCancel ? "on" : ""}`}
            onClick={() => setShowCancel((v) => !v)}
            title="標出曾有預售解約的建案(放大到點位層級顯示)">解約 ⚠</button>
        </div>
        <div className="tbrow">
          <div className="toggle" role="group" title="屋齡篩選:預售=尚未完工;完工後依完工年落帶">
            {FILTERS.map((b) => (
              <button key={b} className={band === b ? "on" : ""} onClick={() => pickBand(b)}>
                {BAND_LABEL[b]}
              </button>
            ))}
          </div>
          <div className="toggle" role="group" title="格局篩選:點位改用該房數成交的單價/總價;無該格局成交的點不顯示">
            {(["all", ...ROOM_BANDS] as RoomFilter[]).map((r) => (
              <button key={r} className={rooms === r ? "on" : ""} onClick={() => pickRooms(r)}>
                {ROOM_LABEL[r]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="legend">
        <div className="ltitle">
          {mode === "rel" ? `相對同屋齡帶行情(${BAND_LABEL[band]})` : `中位單價 萬/坪(${BAND_LABEL[band]})`}
        </div>
        <div className="lgrad" style={{
          background: `linear-gradient(to right, ${(mode === "rel" ? DEV_STOPS : PRICE_STOPS).map((s) => s[1]).join(",")})`,
        }} />
        <div className="lticks">
          {mode === "rel"
            ? <><span>-15% 便宜</span><span>行情</span><span>+15% 貴</span></>
            : <><span>$20</span><span>$32</span><span>$44</span></>}
        </div>
        <div className="lnote">
          {[
            mode === "rel" ? "區/圈 vs 全市同帶中位.點位 vs 生活圈同帶中位" : null,
            detail ? "○ 預售 ● 已完工" : null,
            rooms !== "all" ? `點位僅計 ${ROOM_LABEL[rooms]} 成交(色塊仍為全格局)` : null,
          ].filter(Boolean).join("・")}
        </div>
      </div>

      {detail && <button className="backbtn" onClick={back}>← 返回全市</button>}
      {!detail && <div className="zoomhint">滾輪放大或點擊行政區,可看建案與成交點位</div>}
    </div>
  );
}
