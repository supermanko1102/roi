"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Map, { Source, Layer, Marker, Popup, MapRef } from "react-map-gl/maplibre";
import type { FeatureCollection } from "geojson";
import ProjectDrawer from "./ProjectDrawer";
import MapLegend from "./MapLegend";
import {
  ComparePanel, FilterPanel, ProductHeader, ResultsPanel,
  summaryFromFeature, type ProjectSummary, type ViewMode,
} from "./product-kit";
import { type BandFilter } from "@/lib/age";
import { type RoomFilter } from "@/lib/rooms";
import { makeContains, haversineM, geomBbox } from "@/lib/geo";
import {
  type ColorMode, LINE_COLOR,
  fillExpr, priceProp, devProp, priceColor, devColor, devTextColor, fmtDev, augmentDev,
} from "@/lib/map-colors";
import { addMapIcons, houseIconExpr, pillTextColorExpr } from "@/lib/map-icons";
import "maplibre-gl/dist/maplibre-gl.css";

// 預售 only:地圖上只有建案點;中古成交仍留在區/圈聚合裡當「行情基準」,但不再是可瀏覽的點位

// 總價帶篩選:預售買家用預算找案,不是用單價
const TOTAL_FILTERS: { key: string; label: string; min?: number; max?: number }[] = [
  { key: "all", label: "不限總價" },
  { key: "1000", label: "1,000萬內", max: 1000 },
  { key: "1500", label: "1,000–1,500萬", min: 1000, max: 1500 },
  { key: "2000", label: "1,500–2,000萬", min: 1500, max: 2000 },
  { key: "2000p", label: "2,000萬+", min: 2000 },
];

type PresalePopup = {
  lng: number; lat: number;
  name: string; district: string; deal_count: number;
  price: number | null; median_total: number | null; median_area: number | null;
  band: string; build_year: number | null;
  cancel_count: number;
  st_name: string | null; st_line: string | null; st_m: number | null; // 最近車站
  ic_name: string | null; ic_m: number | null;                          // 最近交流道
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

function readInitialView() {
  if (typeof window === "undefined") return { longitude: 121.25, latitude: 24.94, zoom: 10.3 };
  const q = new URLSearchParams(location.search);
  const longitude = +(q.get("lng") ?? 121.25), latitude = +(q.get("lat") ?? 24.94), zoom = +(q.get("z") ?? 10.3);
  return {
    longitude: Number.isFinite(longitude) ? longitude : 121.25,
    latitude: Number.isFinite(latitude) ? latitude : 24.94,
    zoom: Number.isFinite(zoom) ? zoom : 10.3,
  };
}

export default function PropertyMap() {
  const mapRef = useRef<MapRef>(null);
  const [districts, setDistricts] = useState<FeatureCollection | null>(null);
  const band: BandFilter = "presale"; // 預售 only:色塊/標籤固定看預售行情
  const [mode, setMode] = useState<ColorMode>("rel");
  const [rooms, setRooms] = useState<RoomFilter>("all");
  const [totalBand, setTotalBand] = useState("all");
  const [nearMetro, setNearMetro] = useState(false);
  const [nearIC, setNearIC] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [zoom, setZoom] = useState(10.3);
  const [points, setPoints] = useState<FeatureCollection | null>(null);
  const [presalePopup, setPresalePopup] = useState<PresalePopup | null>(null);
  const [zones, setZones] = useState<FeatureCollection | null>(null);
  const [stations, setStations] = useState<FeatureCollection | null>(null);
  const [catalog, setCatalog] = useState<FeatureCollection | null>(null);
  const [drawerProj, setDrawerProj] = useState<{ district: string; name: string } | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>("map");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saved, setSaved] = useState<ProjectSummary[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const [urlReady, setUrlReady] = useState(false);
  const initialView = useMemo(readInitialView, []);
  const detail = zoom >= DETAIL_ZOOM;
  const zoneLevel = zoom >= DETAIL_ZOOM && zoom < ZONE_FADE;

  useEffect(() => {
    fetch("/api/districts").then((r) => r.json()).then((g) => setDistricts(augmentDev(g)));
    fetch("/api/zones").then((r) => r.json()).then((g) => setZones(augmentDev(g)));
    fetch("/api/stations").then((r) => r.json()).then(setStations);
    const qs = new URLSearchParams(location.search);
    const initialRooms = (["1", "2", "3", "4p"].includes(qs.get("rooms") ?? "") ? qs.get("rooms") : "all") as RoomFilter;
    const initialBudget = TOTAL_FILTERS.some((t) => t.key === qs.get("budget")) ? qs.get("budget")! : "all";
    const initialMode = qs.get("mode") === "abs" ? "abs" : "rel";
    const initialViewMode = qs.get("view") === "list" ? "list" : "map";
    setRooms(initialRooms); setTotalBand(initialBudget); setMode(initialMode); setView(initialViewMode);
    setQuery(qs.get("q") ?? ""); setNearMetro(qs.get("metro") === "1"); setNearIC(qs.get("ic") === "1");
    setShowCancel(qs.get("cancel") === "1");
    loadCatalog(initialRooms);
    try {
      const local = JSON.parse(localStorage.getItem("roi-shortlist") ?? "[]");
      if (Array.isArray(local)) setSaved(local.slice(0, 3));
    } catch { /* 忽略損壞的本機偏好 */ }
    // 深連結:?proj=區|建案名 直接開抽屜(可分享)
    const pj = qs.get("proj");
    if (pj && pj.includes("|")) {
      const [district, ...rest] = pj.split("|");
      setDrawerProj({ district, name: rest.join("|") });
    }
    setUrlReady(true);
  }, []);

  useEffect(() => {
    if (!urlReady) return;
    syncUrl({
      q: query || null, view: view === "list" ? "list" : null,
      budget: totalBand === "all" ? null : totalBand, rooms: rooms === "all" ? null : rooms,
      metro: nearMetro ? "1" : null, ic: nearIC ? "1" : null,
      cancel: showCancel ? "1" : null, mode: mode === "rel" ? null : mode,
    });
  }, [urlReady, query, view, totalBand, rooms, nearMetro, nearIC, showCancel, mode]);

  useEffect(() => {
    if (!urlReady) return;
    localStorage.setItem("roi-shortlist", JSON.stringify(saved));
  }, [saved, urlReady]);

  // 抽屜開關同步到網址,重整/分享都能還原
  function syncUrl(set: Record<string, string | null>) {
    const u = new URL(location.href);
    for (const [k, v] of Object.entries(set)) v == null ? u.searchParams.delete(k) : u.searchParams.set(k, v);
    history.replaceState(null, "", u);
  }
  function openProjDrawer(district: string, name: string) {
    setDrawerProj({ district, name }); setPresalePopup(null);
    syncUrl({ proj: `${district}|${name}` });
  }
  function closeProjDrawer() {
    setDrawerProj(null);
    syncUrl({ proj: null });
  }

  async function loadCatalog(room: RoomFilter) {
    const res = await fetch(`/api/points?kind=presale${room !== "all" ? `&rooms=${room}` : ""}`);
    if (res.ok) setCatalog(await res.json());
  }

  useEffect(() => {
    if (!detail) setPresalePopup(null);
  }, [detail]);

  // 切格局:點位口徑整個換掉,清快取重抓目前視窗
  function pickRooms(r: RoomFilter) {
    setRooms(r); setPresalePopup(null);
    loadCatalog(r);
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

  // 車站/交流道索引(最近距離用;stations.geojson 用 kind 區分)
  const transportIdx = useMemo(() => (stations?.features ?? []).map((f: any) => ({
    name: f.properties.name as string, line: f.properties.line as string,
    status: f.properties.status as string,
    kind: (f.properties.kind ?? "station") as string,
    lng: f.geometry.coordinates[0] as number, lat: f.geometry.coordinates[1] as number,
  })), [stations]);
  const railIdx = useMemo(() => transportIdx.filter((t) => t.kind === "station"), [transportIdx]);
  const icIdx = useMemo(() => transportIdx.filter((t) => t.kind === "interchange"), [transportIdx]);

  // 同一套 enrich 同時餵地圖點位與列表，避免比較基準、交通距離在兩個介面漂移。
  const enrichPoints = useMemo(() => (base: FeatureCollection | null) => {
    if (!base) return null;
    return { ...base, features: (base.features as any[]).map((f) => {
      const p = f.properties;
      const key = !p.band || p.band === "unknown" ? "all" : p.band;
      const [lng, lat] = f.geometry.coordinates;
      let nearby: number | null = null;
      for (const z of zoneIndex) if (z.contains(lng, lat)) { nearby = z.props[`price_${key}`] ?? null; break; }
      if (nearby == null) nearby = distProps[p.district]?.[`price_${key}`] ?? null;
      const dev = nearby && p.price != null ? +((p.price / nearby - 1) * 100).toFixed(1) : null;
      let st: { name: string; line: string; m: number } | null = null;
      for (const s of railIdx) {
        const m = haversineM(lat, lng, s.lat, s.lng);
        if (!st || m < st.m) st = { name: s.name, line: s.line, m };
      }
      let ic: { name: string; m: number } | null = null;
      for (const s of icIdx) {
        const m = haversineM(lat, lng, s.lat, s.lng);
        if (!ic || m < ic.m) ic = { name: s.name, m };
      }
      return { ...f, properties: {
        ...p, dev, dev_label: fmtDev(dev, 0) ?? "",
        ...(st ? { st_name: st.name, st_line: st.line, st_m: Math.round(st.m) } : {}),
        ...(ic ? { ic_name: ic.name, ic_m: Math.round(ic.m) } : {}),
      } };
    }) } as FeatureCollection;
  }, [zoneIndex, distProps, railIdx, icIdx]);

  const applyFilters = useMemo(() => (base: FeatureCollection | null) => {
    if (!base) return null;
    const tf = TOTAL_FILTERS.find((t) => t.key === totalBand)!;
    const needle = query.trim().toLocaleLowerCase("zh-Hant");
    const feats = (base.features as any[])
      .filter((f) => {
        const t = f.properties.median_total;
        if (tf.min != null && (t == null || t < tf.min)) return false;
        if (tf.max != null && (t == null || t >= tf.max)) return false;
        if (needle && !`${f.properties.name ?? ""} ${f.properties.district ?? ""}`.toLocaleLowerCase("zh-Hant").includes(needle)) return false;
        return true;
      })
      .filter((f) => !nearMetro || (f.properties.st_m != null && f.properties.st_m <= 800))
      .filter((f) => !nearIC || (f.properties.ic_m != null && f.properties.ic_m <= 2000));
    return { ...base, features: feats } as FeatureCollection;
  }, [totalBand, query, nearMetro, nearIC]);

  const visiblePoints = useMemo(() => applyFilters(enrichPoints(points)), [points, enrichPoints, applyFilters]);
  const visibleCatalog = useMemo(() => applyFilters(enrichPoints(catalog)), [catalog, enrichPoints, applyFilters]);
  const projectSummaries = useMemo(() => ((visibleCatalog?.features ?? []) as any[])
    .map(summaryFromFeature)
    .sort((a, b) => (a.dev ?? 999) - (b.dev ?? 999) || b.deals - a.deals), [visibleCatalog]);
  const activeFilters = +(totalBand !== "all") + +(rooms !== "all") + +nearMetro + +nearIC + +showCancel;

  // 解約標記:獨立於屋齡帶篩選,永遠拿全部點位過濾
  const cancelPoints = useMemo(() => {
    if (!points) return null;
    return { ...points, features: (points.features as any[]).filter((f) => (f.properties.cancel_count ?? 0) > 0) };
  }, [points]);

  // 標籤放邊界框中心(粗略但夠用;更準可預算 pole of inaccessibility)
  const labels = useMemo(() => {
    if (!districts) return [];
    return districts.features.map((f: any) => {
      const [w, s, e, n] = geomBbox(f.geometry);
      return { name: f.properties.name, lng: (w + e) / 2, lat: (s + n) / 2, props: f.properties };
    });
  }, [districts]);

  // 重劃區標籤同樣放邊界框中心(邊界是官方圖資的 Polygon/MultiPolygon)
  const zoneLabels = useMemo(() => {
    if (!zones) return [];
    return zones.features.map((f: any) => {
      const [w, s, e, n] = geomBbox(f.geometry);
      return {
        name: f.properties.name, lng: (w + e) / 2, lat: (s + n) / 2,
        bounds: [[w, s], [e, n]] as [[number, number], [number, number]],
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
    const res = await fetch(`/api/points?bbox=${bbox.join(",")}&kind=presale${rm !== "all" ? `&rooms=${rm}` : ""}`);
    setPoints(await res.json());
  }

  // 點行政區 → 縮放到該區;顯示什麼由 zoom 門檻決定,與滾輪放大走同一條路
  function drill(name: string) {
    const feat = (districts?.features ?? []).find((f: any) => f.properties.name === name) as any;
    if (!feat) return;
    const [w, s, e, n] = geomBbox(feat.geometry);
    loadDetail([w, s, e, n]); // 與飛行動畫並行抓資料,動畫結束即有點位
    // 面積大的區 fitBounds 後可能還不到細節門檻,保底跨過去
    const map = mapRef.current?.getMap();
    const cam = map?.cameraForBounds([[w, s], [e, n]], { padding: 60 });
    if (map && cam) map.easeTo({ ...cam, zoom: Math.max(cam.zoom ?? DETAIL_ZOOM, DETAIL_ZOOM + 0.1), duration: 700 });
  }
  function back() {
    mapRef.current?.flyTo({ center: [121.25, 24.94], zoom: 10.3, duration: 700 });
  }

  function openPoint(f: any) {
    const p = f.properties;
    // 抽屜開著時點別的建案直接切換內容,維持「掃描→查看→再掃描」的節奏
    if (drawerProj) { openProjDrawer(p.district, p.name); return; }
    const [lng, lat] = f.geometry.coordinates;
    setPresalePopup({
      lng, lat, name: p.name, district: p.district, deal_count: p.deal_count,
      price: p.price ?? null, median_total: p.median_total ?? null,
      median_area: p.median_area ?? null, band: p.band, build_year: p.build_year ?? null,
      cancel_count: p.cancel_count ?? 0,
      st_name: p.st_name ?? null, st_line: p.st_line ?? null, st_m: p.st_m ?? null,
      ic_name: p.ic_name ?? null, ic_m: p.ic_m ?? null,
    });
  }

  function openSummary(p: ProjectSummary) {
    setCompareOpen(false); setView("map");
    mapRef.current?.flyTo({ center: [p.lng, p.lat], zoom: 15.4, duration: 650 });
    openProjDrawer(p.district, p.name);
  }

  function toggleSaved(p: ProjectSummary) {
    setSaved((current) => {
      if (current.some((x) => x.key === p.key)) return current.filter((x) => x.key !== p.key);
      if (current.length >= 3) { setCompareOpen(true); return current; }
      return [...current, p];
    });
  }

  function resetFilters() {
    setTotalBand("all"); pickRooms("all"); setNearMetro(false); setNearIC(false); setShowCancel(false);
  }

  async function shareCurrent() {
    try {
      await navigator.clipboard.writeText(location.href);
      setShared(true); window.setTimeout(() => setShared(false), 1800);
    } catch { setShared(false); }
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Map
        ref={mapRef}
        mapStyle={BASE_STYLE}
        initialViewState={initialView}
        onLoad={(e) => {
          e.target.resize(); // 容器尺寸就緒前 canvas 可能只畫一角
          addMapIcons(e.target); // 房屋/膠囊/交流道圖示(canvas 現畫)
        }}
        onMove={(e) => {
          // 動畫/拖曳中只在跨越門檻時更新,避免每幀重繪 DOM markers
          const z = e.viewState.zoom;
          setZoom((prev) => ((prev >= DETAIL_ZOOM) !== (z >= DETAIL_ZOOM) ? z : prev));
        }}
        onMoveEnd={(e) => {
          setZoom(e.viewState.zoom);
          syncUrl({
            lng: e.viewState.longitude.toFixed(5), lat: e.viewState.latitude.toFixed(5),
            z: e.viewState.zoom.toFixed(2),
          });
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
          } else if (f.layer.id === "pt-icon" || f.layer.id === "pt-pill") {
            openPoint(f);
          } else if (f.layer.id === "zone-fill") {
            zoomToZone((f.properties as any).name);
          } else if (!detail) {
            drill((f.properties as any).name);
          }
        }}
        interactiveLayerIds={detail
          ? (zoneLevel ? ["pt-cluster", "pt-icon", "pt-pill", "zone-fill"] : ["pt-cluster", "pt-icon", "pt-pill"])
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
            {/* 建案=房屋圖示:預售中空心、已完工實心;顏色依模式分桶(15 起讓位給價格膠囊) */}
            <Layer id="pt-icon" type="symbol" filter={["!", ["has", "point_count"]]}
              maxzoom={15}
              layout={{
                "icon-image": houseIconExpr(mode) as any,
                "icon-size": ["interpolate", ["linear"], ["zoom"], 12, 0.72, 15, 1] as any,
                "icon-allow-overlap": true,
              }} />
            {/* 價格膠囊:白底圓角、文字色帶判讀;rel=±%、abs=單價(格局篩選時改總價) */}
            <Layer id="pt-pill" type="symbol" filter={["!", ["has", "point_count"]]}
              minzoom={15}
              layout={{
                "icon-image": "pill",
                "icon-text-fit": "both",
                "text-field": (() => {
                  const val: any = mode === "rel"
                    ? ["case", ["==", ["get", "dev"], null],
                       ["concat", "$", ["to-string", ["get", "price"]]], ["get", "dev_label"]]
                    : rooms !== "all" ? ["concat", ["to-string", ["get", "median_total"]], "萬"]
                    : ["concat", "$", ["to-string", ["get", "price"]]];
                  return val;
                })() as any,
                "text-font": ["Open Sans Semibold"], "text-size": 12.5,
              }}
              paint={{ "text-color": pillTextColorExpr(mode) as any }} />
            <Layer id="pt-name" type="symbol" filter={["!", ["has", "point_count"]]}
              minzoom={15}
              layout={{
                "text-field": ["get", "name"] as any,
                "text-font": ["Open Sans Semibold"], "text-size": 11,
                "text-offset": [0, 1.5], "text-anchor": "top",
                "text-optional": true,
              }}
              paint={{ "text-color": "#22303a", "text-halo-color": "#fff", "text-halo-width": 1.5 }} />
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
              <button type="button"
                className={`dlabel ${noData ? "nodata" : ""}`}
                onClick={(e) => { e.stopPropagation(); drill(l.name); }}
                title={rel && dev != null ? `這一區預售一坪約 $${price ?? "—"} 萬,和全市預售行情相比` : undefined}
              >
                <span className="dname">{l.name}</span>
                <span className="dval num"
                  style={rel && !noData ? { background: devColor(+dev), color: devTextColor(+dev) } : undefined}>
                  {noData ? "資料不足" : rel ? fmtDev(+dev) : `$${(+price).toFixed(1)}`}
                </span>
              </button>
            </Marker>
          );
        })}

        {zoneLevel && zoneLabels.map((l) => {
          const price = l.props[priceProp(band)], dev = l.props[devProp(band)];
          const rel = mode === "rel";
          const v = rel ? dev : price;
          return (
            <Marker key={l.name} longitude={l.lng} latitude={l.lat} anchor="center">
              <button type="button" className="zlabel" onClick={(e) => { e.stopPropagation(); zoomToZone(l.name); }}
                title={`${l.name}:預售 ${l.props[`n_${band}`] ?? 0} 筆成交${rel && price != null ? `・一坪約 $${(+price).toFixed(1)} 萬` : ""}`}>
                <span className="zname">{l.name}</span>
                <span className="zval num"
                  style={rel && v != null ? { background: devColor(+v), color: devTextColor(+v) } : undefined}>
                  {v == null ? "—" : rel ? fmtDev(+v) : `$${(+v).toFixed(1)}`}
                </span>
              </button>
            </Marker>
          );
        })}

        {/* 車站+交流道圖層:車站圓點(營運實心、施工空心)、交流道菱形;放大到細節層才出現 */}
        {stations && detail && (
          <Source id="stations" type="geojson" data={stations}>
            <Layer id="st-pt" type="circle" filter={["!=", ["get", "kind"], "interchange"]}
              paint={{
                "circle-color": ["case", ["==", ["get", "status"], "construction"], "#ffffff",
                  ["match", ["get", "line"], ...Object.entries(LINE_COLOR).flat(), "#666"]] as any,
                "circle-stroke-color": ["match", ["get", "line"], ...Object.entries(LINE_COLOR).flat(), "#666"] as any,
                "circle-radius": 5.5, "circle-stroke-width": 2.5,
              }} />
            <Layer id="ic-pt" type="symbol" filter={["==", ["get", "kind"], "interchange"]}
              layout={{ "icon-image": "ic-diamond", "icon-size": 0.6, "icon-allow-overlap": true }} />
            <Layer id="st-label" type="symbol" minzoom={13}
              layout={{
                "text-field": ["case", ["==", ["get", "status"], "construction"],
                  ["concat", ["get", "name"], "(施工中)"], ["get", "name"]] as any,
                "text-font": ["Open Sans Semibold"], "text-size": 11,
                "text-offset": [0, -1.4], "text-anchor": "bottom", "text-optional": true,
              }}
              paint={{
                "text-color": ["case", ["==", ["get", "kind"], "interchange"], "#37474f",
                  ["match", ["get", "line"], ...Object.entries(LINE_COLOR).flat(), "#666"]] as any,
                "text-halo-color": "#fff", "text-halo-width": 1.6,
              }} />
          </Source>
        )}

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
                <span>一坪約(萬,已扣車位)</span>
              </div>
              <dl>
                <div><dt>一戶大約</dt><dd className="num">
                  {presalePopup.median_total == null ? "—" : (+presalePopup.median_total).toLocaleString() + " 萬"}</dd></div>
                <div><dt>坪數大約</dt><dd className="num">
                  {presalePopup.median_area == null ? "—" : (+presalePopup.median_area).toFixed(0) + " 坪"}</dd></div>
              </dl>
              {((presalePopup.st_m != null && presalePopup.st_m <= 2400) ||
                (presalePopup.ic_m != null && presalePopup.ic_m <= 3000)) && (
                <div className="note" style={{ borderTop: "none", marginTop: 5, paddingTop: 0 }}>
                  {presalePopup.st_name && presalePopup.st_m != null && presalePopup.st_m <= 2400 &&
                    <>🚉 {presalePopup.st_name}({presalePopup.st_line})步行約 {Math.max(1, Math.round(presalePopup.st_m * 1.3 / 80))} 分<br /></>}
                  {presalePopup.ic_name && presalePopup.ic_m != null && presalePopup.ic_m <= 3000 &&
                    <>🛣️ {presalePopup.ic_name}約 {(presalePopup.ic_m / 1000).toFixed(1)} 公里</>}
                </div>
              )}
              {presalePopup.cancel_count > 0 && (
                <div className="cancelnote">⚠ 本案曾有 {presalePopup.cancel_count} 筆解約(未計入價格統計)</div>
              )}
              <button className="detailbtn"
                onClick={() => openProjDrawer(presalePopup.district, presalePopup.name)}>
                查看建案詳情(銷售、格局、交通)→
              </button>
            </div>
          </Popup>
        )}
      </Map>

      <ProductHeader query={query} setQuery={(v) => { setQuery(v); if (v) setView("list"); }}
        view={view} setView={setView} filtersOpen={filtersOpen} setFiltersOpen={setFiltersOpen}
        activeFilters={activeFilters} savedCount={saved.length} openCompare={() => setCompareOpen(true)}
        share={shareCurrent} shared={shared} />

      <FilterPanel open={filtersOpen} mode={mode} setMode={setMode}
        totalBand={totalBand} setTotalBand={(v) => { setTotalBand(v); setPresalePopup(null); }}
        rooms={rooms} setRooms={pickRooms} nearMetro={nearMetro} setNearMetro={setNearMetro}
        nearIC={nearIC} setNearIC={setNearIC} showCancel={showCancel} setShowCancel={setShowCancel}
        reset={resetFilters} />

      <ResultsPanel open={view === "list"} projects={projectSummaries.slice(0, 100)}
        totalCount={projectSummaries.length} saved={saved} onOpen={openSummary} onToggleSaved={toggleSaved} />

      <ComparePanel open={compareOpen} saved={saved} onClose={() => setCompareOpen(false)}
        onRemove={toggleSaved} onOpen={openSummary} />

      {drawerProj && <ProjectDrawer district={drawerProj.district} name={drawerProj.name}
        zones={zones} stations={stations} onClose={closeProjDrawer}
        saved={saved.some((p) => p.key === `${drawerProj.district}|${drawerProj.name}`)}
        onToggleSaved={() => {
          const found = (enrichPoints(catalog)?.features as any[] | undefined)?.find(
            (f) => `${f.properties.district}|${f.properties.name}` === `${drawerProj.district}|${drawerProj.name}`);
          if (found) toggleSaved(summaryFromFeature(found));
        }} />}

      <MapLegend mode={mode} rooms={rooms} nearMetro={nearMetro} nearIC={nearIC}
        detail={detail} showStations={stations != null} />

      {detail && <button className="backbtn" onClick={back}>← 返回全市</button>}
      <div className="map-status">
        <strong>{projectSummaries.length || "—"}</strong>
        <span>{detail ? "個符合建案" : "個全市建案・點行政區開始探索"}</span>
      </div>
    </div>
  );
}
