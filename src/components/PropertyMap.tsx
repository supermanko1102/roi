"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Map, { Source, Layer, Marker, Popup, MapRef } from "react-map-gl/maplibre";
import type { FeatureCollection } from "geojson";
import ProjectDrawer from "./ProjectDrawer";
import MapLegend from "./MapLegend";
import {
  ComparePanel, FilterPanel, ProductHeader,
  rentalSummaryFromFeature, summaryFromFeature,
  type MarketMode, type ProjectSummary, type RentalSummary, type SearchSuggestion,
} from "./product-kit";
import { type BandFilter } from "@/lib/age";
import { type RoomFilter } from "@/lib/rooms";
import { haversineM, geomBbox } from "@/lib/geo";
import { LINE_COLOR, priceProp } from "@/lib/map-colors";
import { CITIES, DEFAULT_VIEW, cityDisplay } from "@/lib/cities";
import { addMapIcons } from "@/lib/map-icons";
import "maplibre-gl/dist/maplibre-gl.css";

// 預售與租屋是兩個並列的瀏覽模式，不互相疊加。

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
  name: string; city: string; district: string; deal_count: number;
  price: number | null; median_total: number | null; median_area: number | null;
  band: string; build_year: number | null;
  cancel_count: number;
  st_name: string | null; st_line: string | null; st_m: number | null; // 最近車站
  ic_name: string | null; ic_m: number | null;                          // 最近交流道
};

type RentalPopup = {
  lng: number; lat: number; name: string | null; district: string; address: string;
  building_type: string; build_year: number; age: number; monthly_rent: number;
  housing_rent: number; parking_rent: number | null;
  area_ping: number; rent_per_ping: number; deal_count: number; last_deal: string | null;
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
  layers: [
    // 底色墊在 raster 下:tile 未載入時顯示紙色,而不是透出頁面底色像破圖
    { id: "bg", type: "background", paint: { "background-color": "#fafaf7" } },
    { id: "carto", type: "raster", source: "carto" },
  ],
};

// 樂居式層級切換:zoom 過門檻自動浮出點位,行政區色塊同步淡出
const DETAIL_ZOOM = 14;
// 重劃區/生活圈先獨立呈現；再放大一級才顯示建案點。
const POINT_ZOOM = 16;
// 多城市時全區遠景不塞 54 個區標,先顯示城市級標籤
const CITY_LABEL_ZOOM = 12;
// 滾輪改階梯式縮放:每滾一格跳到下一個語意層級(全區→行政區→生活圈→建案→街廓),
// 不會停在生活圈半透明、點又還沒出來的中間態;必須遞增排序
const ZOOM_STEPS = [10, CITY_LABEL_ZOOM, DETAIL_ZOOM, POINT_ZOOM, 17.5];

function readInitialView() {
  if (typeof window === "undefined") return DEFAULT_VIEW;
  const q = new URLSearchParams(location.search);
  const longitude = +(q.get("lng") ?? DEFAULT_VIEW.longitude), latitude = +(q.get("lat") ?? DEFAULT_VIEW.latitude),
    zoom = +(q.get("z") ?? DEFAULT_VIEW.zoom);
  return {
    longitude: Number.isFinite(longitude) ? longitude : DEFAULT_VIEW.longitude,
    latitude: Number.isFinite(latitude) ? latitude : DEFAULT_VIEW.latitude,
    zoom: Number.isFinite(zoom) ? zoom : DEFAULT_VIEW.zoom,
  };
}

export default function PropertyMap() {
  const mapRef = useRef<MapRef>(null);
  const initialView = useMemo(readInitialView, []);
  const [districts, setDistricts] = useState<FeatureCollection | null>(null);
  const band: BandFilter = "presale";
  const [market, setMarket] = useState<MarketMode>("presale");
  const [rooms, setRooms] = useState<RoomFilter>("all");
  const [totalBand, setTotalBand] = useState("all");
  const [nearMetro, setNearMetro] = useState(false);
  const [nearIC, setNearIC] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [zoom, setZoom] = useState(initialView.zoom);
  const [points, setPoints] = useState<FeatureCollection | null>(null);
  const [presalePopup, setPresalePopup] = useState<PresalePopup | null>(null);
  const [zones, setZones] = useState<FeatureCollection | null>(null);
  const [stations, setStations] = useState<FeatureCollection | null>(null);
  const [rails, setRails] = useState<FeatureCollection | null>(null);
  const [rentals, setRentals] = useState<FeatureCollection | null>(null);
  const [rentalPopup, setRentalPopup] = useState<RentalPopup | null>(null);
  const [catalog, setCatalog] = useState<FeatureCollection | null>(null);
  const [drawerProj, setDrawerProj] = useState<{ city: string; district: string; name: string } | null>(null);
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saved, setSaved] = useState<ProjectSummary[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const [urlReady, setUrlReady] = useState(false);
  const detail = zoom >= DETAIL_ZOOM;
  const zoneLevel = zoom >= DETAIL_ZOOM && zoom < POINT_ZOOM;
  const pointsVisible = zoom >= POINT_ZOOM;

  useEffect(() => {
    fetch("/api/districts").then((r) => r.json()).then(setDistricts);
    fetch("/api/zones").then((r) => r.json()).then(setZones);
    fetch("/api/stations").then((r) => r.json()).then(setStations);
    fetch("/api/rail-lines").then((r) => r.json()).then(setRails);
    const qs = new URLSearchParams(location.search);
    const initialRooms = (["1", "2", "3", "4p"].includes(qs.get("rooms") ?? "") ? qs.get("rooms") : "all") as RoomFilter;
    const initialBudget = TOTAL_FILTERS.some((t) => t.key === qs.get("budget")) ? qs.get("budget")! : "all";
    const initialMarket: MarketMode = qs.get("market") === "rent" || qs.get("rent") === "1" ? "rental" : "presale";
    setRooms(initialRooms); setTotalBand(initialBudget); setMarket(initialMarket);
    setQuery(qs.get("q") ?? ""); setNearMetro(qs.get("metro") === "1"); setNearIC(qs.get("ic") === "1");
    setShowCancel(qs.get("cancel") === "1");
    loadCatalog(initialRooms);
    try {
      const local = JSON.parse(localStorage.getItem("roi-shortlist") ?? "[]");
      // 多城市之前存的比較清單沒有 city → 一律視為桃園市並重算 key
      if (Array.isArray(local)) setSaved(local.slice(0, 3).map((p: any) =>
        p.city ? p : { ...p, city: "桃園市", key: `桃園市|${p.district}|${p.name}` }));
    } catch { /* 忽略損壞的本機偏好 */ }
    // 深連結:?proj=城市|區|建案名 直接開抽屜(可分享);舊網址只有 區|建案名 → 桃園市
    const pj = qs.get("proj");
    if (initialMarket === "presale" && pj && pj.includes("|")) {
      const seg = pj.split("|");
      if (seg.length >= 3) {
        const [city, district, ...rest] = seg;
        setDrawerProj({ city, district, name: rest.join("|") });
      } else {
        setDrawerProj({ city: "桃園市", district: seg[0], name: seg[1] });
      }
    }
    setUrlReady(true);
  }, []);

  useEffect(() => {
    if (!urlReady) return;
    syncUrl({
      q: query || null,
      budget: totalBand === "all" ? null : totalBand, rooms: rooms === "all" ? null : rooms,
      metro: nearMetro ? "1" : null, ic: nearIC ? "1" : null,
      cancel: showCancel ? "1" : null,
      market: market === "rental" ? "rent" : null, rent: null, mode: null, view: null,
    });
  }, [urlReady, query, totalBand, rooms, nearMetro, nearIC, showCancel, market]);

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
  function openProjDrawer(city: string, district: string, name: string) {
    setDrawerProj({ city, district, name }); setPresalePopup(null);
    syncUrl({ proj: `${city}|${district}|${name}` });
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
    if (!pointsVisible) setPresalePopup(null);
  }, [pointsVisible]);

  useEffect(() => {
    if (market !== "rental") { setRentalPopup(null); return; }
    if (!rentals) fetch("/api/rentals").then((r) => r.json()).then(setRentals);
  }, [market, rentals]);

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

  // 車站/交流道索引(最近距離用;stations.geojson 用 kind 區分)
  const transportIdx = useMemo(() => (stations?.features ?? []).map((f: any) => ({
    name: f.properties.name as string, line: f.properties.line as string,
    status: f.properties.status as string,
    kind: (f.properties.kind ?? "station") as string,
    lng: f.geometry.coordinates[0] as number, lat: f.geometry.coordinates[1] as number,
  })), [stations]);
  const railIdx = useMemo(() => transportIdx.filter((t) => t.kind === "station"), [transportIdx]);
  const icIdx = useMemo(() => transportIdx.filter((t) => t.kind === "interchange"), [transportIdx]);

  // 同一套交通距離同時餵地圖點位與列表。
  const enrichPoints = useMemo(() => (base: FeatureCollection | null) => {
    if (!base) return null;
    return { ...base, features: (base.features as any[]).map((f) => {
      const p = f.properties;
      const [lng, lat] = f.geometry.coordinates;
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
        ...p,
        ...(st ? { st_name: st.name, st_line: st.line, st_m: Math.round(st.m) } : {}),
        ...(ic ? { ic_name: ic.name, ic_m: Math.round(ic.m) } : {}),
      } };
    }) } as FeatureCollection;
  }, [railIdx, icIdx]);

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
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant")), [visibleCatalog]);
  const rentalSummaries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-Hant");
    return ((rentals?.features ?? []) as any[])
      .filter((f) => !needle || `${f.properties.name ?? ""} ${f.properties.address ?? ""} ${f.properties.district ?? ""}`
        .toLocaleLowerCase("zh-Hant").includes(needle))
      .map(rentalSummaryFromFeature)
      .sort((a, b) => String(b.lastDeal ?? "").localeCompare(String(a.lastDeal ?? "")));
  }, [rentals, query]);
  const rentalCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rentalSummaries) counts[`${r.city}|${r.district}`] = (counts[`${r.city}|${r.district}`] ?? 0) + 1;
    return counts;
  }, [rentalSummaries]);
  const activeFilters = +(totalBand !== "all") + +(rooms !== "all") + +nearMetro + +nearIC + +showCancel;

  // 解約標記:獨立於屋齡帶篩選,永遠拿全部點位過濾
  const cancelPoints = useMemo(() => {
    if (!points) return null;
    return { ...points, features: (points.features as any[]).filter((f) => (f.properties.cancel_count ?? 0) > 0) };
  }, [points]);

  // 標籤放邊界框中心(粗略但夠用;更準可預算 pole of inaccessibility)
  // key=城市|區名:跨市撞區名(如中正區)時識別用,顯示仍用 name
  const labels = useMemo(() => {
    if (!districts) return [];
    return districts.features.map((f: any) => {
      const [w, s, e, n] = geomBbox(f.geometry);
      return {
        key: `${f.properties.city}|${f.properties.name}`,
        name: f.properties.name, lng: (w + e) / 2, lat: (s + n) / 2, props: f.properties,
      };
    });
  }, [districts]);

  // 重劃區標籤同樣放邊界框中心(邊界是官方圖資的 Polygon/MultiPolygon)
  const zoneLabels = useMemo(() => {
    if (!zones) return [];
    return zones.features.map((f: any) => {
      const [w, s, e, n] = geomBbox(f.geometry);
      return {
        key: f.properties.zone_key ?? f.properties.name,
        name: f.properties.name, lng: (w + e) / 2, lat: (s + n) / 2,
        bounds: [[w, s], [e, n]] as [[number, number], [number, number]],
        props: f.properties,
      };
    });
  }, [zones]);

  // 搜尋下拉建議:比對建案/生活圈/行政區(租屋模式比對社區名與地址),取代原本的列表模式
  const suggestions = useMemo<SearchSuggestion[]>(() => {
    const needle = query.trim().toLocaleLowerCase("zh-Hant");
    if (!needle) return [];
    const hit = (s: string | null | undefined) => (s ?? "").toLocaleLowerCase("zh-Hant").includes(needle);
    const cityTag = (city?: string) => (city && CITIES.length > 1 ? `${cityDisplay(city)}・` : "");
    if (market === "rental") {
      return ((rentals?.features ?? []) as any[])
        .filter((f) => hit(f.properties.name) || hit(f.properties.address) || hit(f.properties.district))
        .slice(0, 8)
        .map((f) => ({
          kind: "rental" as const, key: f.properties.key,
          label: f.properties.name ?? f.properties.address,
          sub: `${cityTag(f.properties.city)}${f.properties.district}`,
        }));
    }
    const projs = ((catalog?.features ?? []) as any[])
      .filter((f) => hit(f.properties.name)).slice(0, 6)
      .map((f) => ({
        kind: "project" as const,
        key: `${f.properties.city}|${f.properties.district}|${f.properties.name}`,
        label: f.properties.name as string,
        sub: `${cityTag(f.properties.city)}${f.properties.district}${f.properties.price != null ? `・$${(+f.properties.price).toFixed(1)}` : ""}`,
      }));
    const zs = zoneLabels.filter((l) => hit(l.name)).slice(0, 3)
      .map((l) => ({ kind: "zone" as const, key: l.key as string, label: l.name as string,
        sub: cityTag(l.props.city).replace(/・$/, "") || undefined }));
    const ds = labels.filter((l) => hit(l.name)).slice(0, 3)
      .map((l) => ({ kind: "district" as const, key: l.key, label: l.name as string,
        sub: cityTag(l.props.city).replace(/・$/, "") || undefined }));
    return [...projs, ...zs, ...ds];
  }, [query, market, catalog, rentals, zoneLabels, labels]);

  function pickSuggestion(s: SearchSuggestion) {
    setQuery(""); // 選中即導航:query 是導航輸入,不留著當篩選
    if (s.kind === "project") {
      const f = (catalog?.features as any[] | undefined)?.find(
        (x) => `${x.properties.city}|${x.properties.district}|${x.properties.name}` === s.key);
      if (f) openSummary(summaryFromFeature(f));
    } else if (s.kind === "zone") {
      zoomToZone(s.key);
    } else if (s.kind === "district") {
      drill(s.key);
    } else {
      const f = (rentals?.features as any[] | undefined)?.find((x) => x.properties.key === s.key);
      if (f) openRentalSummary(rentalSummaryFromFeature(f));
    }
  }

  function zoomToZone(zoneKey: string) {
    const z = zoneLabels.find((l) => l.key === zoneKey);
    if (!z) return;
    loadDetail([z.bounds[0][0], z.bounds[0][1], z.bounds[1][0], z.bounds[1][1]]); // 與飛行動畫並行抓資料
    // 點生活圈直接落在建案層級,不用再手動放大一次;
    // 大圈保底跨過 POINT_ZOOM,小圈上限 +1.5 避免過度放大
    const map = mapRef.current?.getMap();
    const cam = map?.cameraForBounds(z.bounds, { padding: 54 });
    if (map && cam) map.easeTo({
      ...cam,
      zoom: Math.min(Math.max(cam.zoom ?? POINT_ZOOM, POINT_ZOOM + 0.15), POINT_ZOOM + 1.5),
      duration: 600,
    });
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
  function drill(key: string) {
    const feat = (districts?.features ?? [])
      .find((f: any) => `${f.properties.city}|${f.properties.name}` === key) as any;
    if (!feat) return;
    const [w, s, e, n] = geomBbox(feat.geometry);
    if (market === "presale") loadDetail([w, s, e, n]);
    // 面積大的區 fitBounds 後可能還不到細節門檻,保底跨過去
    const map = mapRef.current?.getMap();
    const cam = map?.cameraForBounds([[w, s], [e, n]], { padding: 60 });
    if (map && cam) map.easeTo({ ...cam, zoom: Math.max(cam.zoom ?? DETAIL_ZOOM, DETAIL_ZOOM + 0.1), duration: 700 });
  }
  function back() {
    mapRef.current?.flyTo({
      center: [DEFAULT_VIEW.longitude, DEFAULT_VIEW.latitude],
      zoom: DEFAULT_VIEW.zoom, duration: 700,
    });
  }

  function openPoint(f: any) {
    const p = f.properties;
    // 抽屜開著時點別的建案直接切換內容,維持「掃描→查看→再掃描」的節奏
    if (drawerProj) { openProjDrawer(p.city, p.district, p.name); return; }
    const [lng, lat] = f.geometry.coordinates;
    setPresalePopup({
      lng, lat, name: p.name, city: p.city, district: p.district, deal_count: p.deal_count,
      price: p.price ?? null, median_total: p.median_total ?? null,
      median_area: p.median_area ?? null, band: p.band, build_year: p.build_year ?? null,
      cancel_count: p.cancel_count ?? 0,
      st_name: p.st_name ?? null, st_line: p.st_line ?? null, st_m: p.st_m ?? null,
      ic_name: p.ic_name ?? null, ic_m: p.ic_m ?? null,
    });
  }

  function openRental(f: any) {
    const p = f.properties, [lng, lat] = f.geometry.coordinates;
    setPresalePopup(null);
    setRentalPopup({
      lng, lat, name: p.name ?? null, district: p.district, address: p.address,
      building_type: p.building_type, build_year: +p.build_year, age: +p.age,
      monthly_rent: +p.monthly_rent, area_ping: +p.area_ping,
      housing_rent: +(p.housing_rent ?? p.monthly_rent),
      parking_rent: p.parking_rent == null ? null : +p.parking_rent,
      rent_per_ping: +p.rent_per_ping, deal_count: +p.deal_count,
      last_deal: p.last_deal ?? null,
    });
  }

  function openSummary(p: ProjectSummary) {
    setCompareOpen(false);
    mapRef.current?.flyTo({ center: [p.lng, p.lat], zoom: 15.4, duration: 650 });
    openProjDrawer(p.city, p.district, p.name);
  }

  function openRentalSummary(r: RentalSummary) {
    mapRef.current?.flyTo({ center: [r.lng, r.lat], zoom: 15.4, duration: 650 });
    setRentalPopup({
      lng: r.lng, lat: r.lat, name: r.name, district: r.district, address: r.address,
      building_type: r.buildingType, build_year: new Date().getFullYear() - r.age, age: r.age,
      monthly_rent: r.monthlyRent, housing_rent: r.housingRent, parking_rent: r.parkingRent,
      area_ping: r.area, rent_per_ping: r.rentPerPing, deal_count: r.deals, last_deal: r.lastDeal,
    });
  }

  function changeMarket(next: MarketMode) {
    setMarket(next);
    setQuery("");
    setFiltersOpen(false);
    setPresalePopup(null);
    setRentalPopup(null);
    if (next === "rental") closeProjDrawer();
    if (next === "presale") {
      const map = mapRef.current?.getMap();
      if (map && map.getZoom() >= DETAIL_ZOOM) {
        const b = map.getBounds();
        loadDetail([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      }
    }
  }

  function toggleSaved(p: ProjectSummary) {
    setSaved((current) => {
      if (current.some((x) => x.key === p.key)) return current.filter((x) => x.key !== p.key);
      if (current.length >= 3) { setCompareOpen(true); return current; }
      return [...current, p];
    });
  }

  function resetFilters() {
    setTotalBand("all"); pickRooms("all"); setNearMetro(false); setNearIC(false);
    setShowCancel(false);
  }

  async function shareCurrent() {
    try {
      await navigator.clipboard.writeText(location.href);
      setShared(true); window.setTimeout(() => setShared(false), 1800);
    } catch { setShared(false); }
  }

  function handleMapCursor(e: any) {
    const feature = e.features?.[0];
    e.target.getCanvas().style.cursor = feature ? "pointer" : "";
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Map
        ref={mapRef}
        mapStyle={BASE_STYLE}
        initialViewState={initialView}
        minZoom={10}
        maxZoom={18}
        scrollZoom={false}
        maxBounds={[[117.6, 21.3], [123.2, 26.6]]}
        onLoad={(e) => {
          const map = e.target;
          map.resize(); // 容器尺寸就緒前 canvas 可能只畫一角
          // 內建 ResizeObserver 走 rAF,分頁被節流時 canvas 會停在舊尺寸好幾秒;
          // 用 timer 當看門狗,載入後幾秒內發現 canvas 與容器不一致就強制校正
          const watchdog = setInterval(() => {
            const el = map.getContainer(), c = map.getCanvas();
            if (Math.abs(el.clientWidth - c.clientWidth) > 1 || Math.abs(el.clientHeight - c.clientHeight) > 1) map.resize();
          }, 300);
          setTimeout(() => clearInterval(watchdog), 5000);
          addMapIcons(map); // 房屋/膠囊/交流道圖示(canvas 現畫)
          // 階梯式滾輪縮放(內建 scrollZoom 已停用):一次手勢走一階,以游標為中心;
          // pinch/雙擊/點擊導航仍是連續縮放,之後滾動會被吸回最近的上下一階
          map.getCanvas().addEventListener("wheel", (ev) => {
            ev.preventDefault();
            if (map.isEasing()) return;
            const z = map.getZoom();
            const next = ev.deltaY < 0
              ? ZOOM_STEPS.find((s) => s > z + 0.01)
              : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.01);
            if (next == null) return;
            const rect = map.getCanvas().getBoundingClientRect();
            map.easeTo({
              zoom: next,
              around: map.unproject([ev.clientX - rect.left, ev.clientY - rect.top]),
              duration: 450,
            });
          }, { passive: false });
          setZoom(e.target.getZoom());
          if (e.target.getZoom() >= DETAIL_ZOOM) {
            const b = e.target.getBounds();
            loadDetail([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
          }
        }}
        onMove={(e) => {
          // 動畫/拖曳中只在跨越門檻時更新,避免每幀重繪 DOM markers
          const z = e.viewState.zoom;
          setZoom((prev) => (
            (prev >= DETAIL_ZOOM) !== (z >= DETAIL_ZOOM) ||
            (prev >= POINT_ZOOM) !== (z >= POINT_ZOOM) ? z : prev
          ));
        }}
        onMouseMove={handleMapCursor}
        onMouseLeave={(e) => {
          e.target.getCanvas().style.cursor = "";
        }}
        onMoveEnd={(e) => {
          setZoom(e.viewState.zoom);
          syncUrl({
            lng: e.viewState.longitude.toFixed(5), lat: e.viewState.latitude.toFixed(5),
            z: e.viewState.zoom.toFixed(2),
          });
          if (market === "presale" && e.viewState.zoom >= DETAIL_ZOOM) {
            const b = e.target.getBounds();
            loadDetail([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
          }
        }}
        onClick={(e) => {
          // 不用 e.features:react-map-gl 會沿用滾輪/雙擊縮放前的 hover 快取,
          // 縮放後原地點擊會拿到舊層級的 feature(例如點建案卻命中 zone-fill 而縮回生活圈)。
          // 以地圖當下 zoom 決定可點圖層,在點擊座標重新查詢。
          const map = e.target;
          const z = map.getZoom();
          const clickable = [
            ...(market === "presale"
              ? z >= POINT_ZOOM ? ["pt-cluster", "pt-pill"]
                : z >= DETAIL_ZOOM ? ["zone-fill"] : ["district-fill"]
              : z < DETAIL_ZOOM ? ["district-fill"] : []),
            ...(market === "rental" ? ["rent-cluster", "rent-point", "rent-symbol", "rent-label"] : []),
          ].filter((l) => map.getLayer(l));
          const f = clickable.length ? map.queryRenderedFeatures(e.point, { layers: clickable })[0] : undefined;
          if (!f) return;
          if (market === "rental" && f.layer.id === "rent-cluster") {
            const src: any = mapRef.current?.getSource("rentals");
            src?.getClusterExpansionZoom(f.properties!.cluster_id).then((z: number) =>
              mapRef.current?.easeTo({ center: (f.geometry as any).coordinates, zoom: z + 0.4, duration: 500 }));
          } else if (market === "rental" && ["rent-point", "rent-symbol", "rent-label"].includes(f.layer.id)) {
            openRental(f);
          } else if (market === "presale" && f.layer.id === "pt-cluster") {
            // 點 cluster → 展開放大
            const src: any = mapRef.current?.getSource("points");
            src?.getClusterExpansionZoom(f.properties!.cluster_id).then((z: number) =>
              mapRef.current?.easeTo({ center: (f.geometry as any).coordinates, zoom: z + 0.5, duration: 500 }));
          } else if (market === "presale" && f.layer.id === "pt-pill") {
            openPoint(f);
          } else if (market === "presale" && f.layer.id === "zone-fill") {
            const zp = f.properties as any;
            zoomToZone(zp.zone_key ?? zp.name);
          } else if (z < DETAIL_ZOOM) {
            const dp = f.properties as any;
            drill(`${dp.city}|${dp.name}`);
          }
        }}
        interactiveLayerIds={[
          ...(market === "presale"
            ? pointsVisible ? ["pt-cluster", "pt-pill"]
              : zoneLevel ? ["zone-fill"] : ["district-fill"]
            : !detail ? ["district-fill"] : []),
          ...(market === "rental" ? ["rent-cluster", "rent-point", "rent-symbol", "rent-label"] : []),
        ]}
      >
        {districts && (
          <Source id="districts" type="geojson" data={districts}>
            <Layer id="district-fill" type="fill"
              paint={{
                // 行政區只作導航，不把價格轉譯成色階；跨城市擴充時比較口徑才不會誤導。
                "fill-color": "#f4f5f1",
                "fill-opacity": ["interpolate", ["linear"], ["zoom"],
                  DETAIL_ZOOM - 0.6, 0.12, DETAIL_ZOOM + 0.8, 0.02] as any,
              }} />
            <Layer id="district-line" type="line"
              paint={{
                "line-color": "#71837c",
                "line-width": ["interpolate", ["linear"], ["zoom"],
                  DETAIL_ZOOM - 0.6, 2, DETAIL_ZOOM + 0.8, 1] as any,
              }} />
          </Source>
        )}

        {zones && (
          <Source id="zones" type="geojson" data={zones}>
            <Layer id="zone-fill" type="fill"
              paint={{
                "fill-color": "#0d5b4f",
                "fill-opacity": ["interpolate", ["linear"], ["zoom"],
                  DETAIL_ZOOM - 0.2, 0, DETAIL_ZOOM + 0.2, 0.055,
                  POINT_ZOOM - 0.2, 0.055, POINT_ZOOM, 0] as any,
              }} />
            <Layer id="zone-glow" type="line"
              paint={{
                "line-color": "#0d5b4f", "line-blur": 6,
                "line-width": ["interpolate", ["linear"], ["zoom"],
                  DETAIL_ZOOM, 8, POINT_ZOOM, 12] as any,
                "line-opacity": ["interpolate", ["linear"], ["zoom"],
                  DETAIL_ZOOM - 0.3, 0, DETAIL_ZOOM + 0.2, 0.16,
                  POINT_ZOOM - 0.3, 0.12, POINT_ZOOM, 0] as any,
              }} />
            <Layer id="zone-line" type="line"
              paint={{
                "line-color": "#71837c", "line-width": 1.5,
                "line-dasharray": [2, 1.5],
                "line-opacity": ["interpolate", ["linear"], ["zoom"],
                  DETAIL_ZOOM - 0.4, 0, DETAIL_ZOOM + 0.3, 0.9,
                  POINT_ZOOM - 0.7, 0.9, POINT_ZOOM, 0] as any,
              }} />
          </Source>
        )}

        {market === "rental" && rentals && (
          <Source id="rentals" type="geojson" data={rentals} cluster clusterMaxZoom={14} clusterRadius={44}>
            <Layer id="rent-cluster" type="circle" filter={["has", "point_count"]}
              paint={{
                "circle-color": "#8a6234", "circle-opacity": 0.9,
                "circle-radius": ["step", ["get", "point_count"], 15, 20, 20, 80, 26],
                "circle-stroke-width": 2, "circle-stroke-color": "#fff",
              }} />
            <Layer id="rent-cluster-count" type="symbol" filter={["has", "point_count"]}
              layout={{ "text-field": ["get", "point_count_abbreviated"], "text-size": 12.5 }}
              paint={{ "text-color": "#fff" }} />
            <Layer id="rent-point" type="circle" filter={["!", ["has", "point_count"]]}
              paint={{
                "circle-color": "#fffaf0", "circle-radius": 11,
                "circle-stroke-color": "#8a6234", "circle-stroke-width": 2.5,
              }} />
            <Layer id="rent-symbol" type="symbol" filter={["!", ["has", "point_count"]]}
              layout={{ "text-field": "租", "text-size": 10.5, "text-allow-overlap": true }}
              paint={{ "text-color": "#7a5328" }} />
            <Layer id="rent-label" type="symbol" minzoom={15} filter={["!", ["has", "point_count"]]}
              layout={{
                "text-field": ["get", "rent_label"], "text-size": 11,
                "text-offset": [0, 1.55], "text-anchor": "top", "text-optional": true,
              }}
              paint={{ "text-color": "#6c4b27", "text-halo-color": "#fff", "text-halo-width": 1.7 }} />
          </Source>
        )}

        {market === "presale" && pointsVisible && visiblePoints && (
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
            {/* 價格膠囊:白底圓角；格局篩選時顯示總價，否則顯示單價。
                建案一出場(POINT_ZOOM)就是膠囊,不再有圓點過場。 */}
            <Layer id="pt-pill" type="symbol" filter={["!", ["has", "point_count"]]}
              minzoom={POINT_ZOOM}
              layout={{
                "icon-image": "pill",
                "icon-text-fit": "both",
                "text-field": (rooms !== "all"
                  ? ["concat", ["to-string", ["get", "median_total"]], "萬"]
                  : ["concat", "$", ["to-string", ["get", "price"]]]) as any,
                "text-font": ["Open Sans Semibold"], "text-size": 12.5,
              }}
              paint={{ "text-color": "#22303a" }} />
            <Layer id="pt-name" type="symbol" filter={["!", ["has", "point_count"]]}
              minzoom={POINT_ZOOM}
              layout={{
                "text-field": ["get", "name"] as any,
                "text-font": ["Open Sans Semibold"], "text-size": 11,
                "text-offset": [0, 1.5] as any, // 讓出膠囊高度
                "text-anchor": "top",
                "text-optional": true,
              }}
              paint={{ "text-color": "#22303a", "text-halo-color": "#fff", "text-halo-width": 1.5 }} />
          </Source>
        )}

        {/* 解約標記:紅圈壓在點位上,獨立於屋齡帶/格局篩選 */}
        {market === "presale" && pointsVisible && showCancel && cancelPoints && (
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

        {!detail && CITIES.length > 1 && zoom < CITY_LABEL_ZOOM && CITIES.map((c) => (
          <Marker key={c.name} longitude={c.center[0]} latitude={c.center[1]} anchor="center">
            <button type="button" className="dlabel"
              onClick={(e) => {
                e.stopPropagation();
                mapRef.current?.flyTo({ center: c.center, zoom: c.zoom, duration: 700 });
              }}>
              <span className="dname">{c.display}</span>
            </button>
          </Marker>
        ))}

        {!detail && (CITIES.length === 1 || zoom >= CITY_LABEL_ZOOM) && labels.map((l) => {
          const price = l.props[priceProp(band)];
          const count = rentalCounts[l.key] ?? 0;
          const noData = market === "presale" && price == null;
          return (
            <Marker key={l.key} longitude={l.lng} latitude={l.lat} anchor="center">
              <button type="button"
                className={`dlabel ${noData ? "nodata" : ""}`}
                onClick={(e) => { e.stopPropagation(); drill(l.key); }}
              >
                <span className="dname">{l.name}</span>
                <span className="dval num">
                  {market === "rental" ? `${count} 棟` : noData ? "資料不足" : `$${(+price).toFixed(1)}`}
                </span>
              </button>
            </Marker>
          );
        })}

        {market === "presale" && zoneLevel && zoneLabels.map((l) => {
          const price = l.props[priceProp(band)];
          return (
            <Marker key={l.key} longitude={l.lng} latitude={l.lat} anchor="center">
              <button type="button" className="zlabel"
                onClick={(e) => { e.stopPropagation(); zoomToZone(l.key); }}
                title={`${l.name}:預售 ${l.props[`n_${band}`] ?? 0} 筆成交`}>
                <span className="zname">{l.name}</span>
                <span className="zval num">
                  {price == null ? "—" : `$${(+price).toFixed(1)}`}
                </span>
              </button>
            </Marker>
          );
        })}

        {/* 軌道路線:營運畫實線、施工中畫虛線,墊在車站圓點下方。
            只畫有站點的線(機捷/台鐵/綠線);規劃中路線未定案,刻意不畫。 */}
        {rails && detail && (
          <Source id="rails" type="geojson" data={rails}>
            <Layer id="rail-op" type="line" filter={["==", ["get", "status"], "operating"]}
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": ["match", ["get", "line"], ...Object.entries(LINE_COLOR).flat(), "#888"] as any,
                "line-width": ["interpolate", ["linear"], ["zoom"], DETAIL_ZOOM, 1.6, 16, 3.4] as any,
                "line-opacity": 0.42,
              }} />
            <Layer id="rail-con" type="line" filter={["==", ["get", "status"], "construction"]}
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": ["match", ["get", "line"], ...Object.entries(LINE_COLOR).flat(), "#888"] as any,
                "line-width": ["interpolate", ["linear"], ["zoom"], DETAIL_ZOOM, 1.6, 16, 3.4] as any,
                "line-opacity": 0.55,
                "line-dasharray": [2.4, 1.8],
              }} />
          </Source>
        )}

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

        {market === "presale" && presalePopup && (
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
              <div className="roi">
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
                onClick={() => openProjDrawer(presalePopup.city, presalePopup.district, presalePopup.name)}>
                查看基本資料與成交紀錄 →
              </button>
            </div>
          </Popup>
        )}

        {rentalPopup && (
          <Popup longitude={rentalPopup.lng} latitude={rentalPopup.lat} anchor="bottom"
            onClose={() => setRentalPopup(null)} closeButton maxWidth="300px" offset={16}>
            <div className="popup-card rental-popup">
              <div className="rental-kicker">租賃實價登錄・屋齡 {rentalPopup.age} 年</div>
              <h3>{rentalPopup.name ?? `${rentalPopup.building_type}出租住宅`}</h3>
              <div className="rental-address">{rentalPopup.address}</div>
              <div className="rental-price">
                <b className="num">{rentalPopup.monthly_rent.toLocaleString()}</b><span>元／月</span>
              </div>
              <dl>
                <div><dt>每坪月租</dt><dd className="num">{rentalPopup.rent_per_ping.toLocaleString()} 元</dd></div>
                <div><dt>租賃坪數</dt><dd className="num">約 {rentalPopup.area_ping} 坪</dd></div>
                {rentalPopup.parking_rent != null && <div><dt>其中車位</dt><dd className="num">{rentalPopup.parking_rent.toLocaleString()} 元</dd></div>}
                <div><dt>實登樣本</dt><dd className="num">{rentalPopup.deal_count} 筆</dd></div>
                <div><dt>最近租約</dt><dd className="num">{rentalPopup.last_deal ?? "—"}</dd></div>
              </dl>
              <div className="rental-trust">同門牌租約中位數・排除社宅案件・不代表目前仍在招租</div>
            </div>
          </Popup>
        )}
      </Map>

      <ProductHeader market={market} setMarket={changeMarket}
        query={query} setQuery={setQuery} suggestions={suggestions} onPick={pickSuggestion}
        filtersOpen={filtersOpen} setFiltersOpen={setFiltersOpen}
        activeFilters={activeFilters} savedCount={saved.length} openCompare={() => setCompareOpen(true)}
        share={shareCurrent} shared={shared} />

      {market === "presale" && <FilterPanel open={filtersOpen}
        totalBand={totalBand} setTotalBand={(v) => { setTotalBand(v); setPresalePopup(null); }}
        rooms={rooms} setRooms={pickRooms} nearMetro={nearMetro} setNearMetro={setNearMetro}
        nearIC={nearIC} setNearIC={setNearIC} showCancel={showCancel} setShowCancel={setShowCancel}
        reset={resetFilters} />}

      <ComparePanel open={market === "presale" && compareOpen} saved={saved} onClose={() => setCompareOpen(false)}
        onRemove={toggleSaved} onOpen={openSummary} />

      {drawerProj && <ProjectDrawer city={drawerProj.city} district={drawerProj.district} name={drawerProj.name}
        onClose={closeProjDrawer}
        saved={saved.some((p) => p.key === `${drawerProj.city}|${drawerProj.district}|${drawerProj.name}`)}
        onToggleSaved={() => {
          const found = (enrichPoints(catalog)?.features as any[] | undefined)?.find(
            (f) => `${f.properties.city}|${f.properties.district}|${f.properties.name}` ===
              `${drawerProj.city}|${drawerProj.district}|${drawerProj.name}`);
          if (found) toggleSaved(summaryFromFeature(found));
        }} />}

      <MapLegend market={market} rooms={rooms} nearMetro={nearMetro} nearIC={nearIC}
        detail={detail} showStations={stations != null} />

      {detail && <button className="backbtn" onClick={back}>← 返回{CITIES.length > 1 ? "全區" : "全市"}</button>}
      <div className="map-status">
        <strong>{market === "rental" ? rentalSummaries.length : zoneLevel ? "生活圈" : (projectSummaries.length || "—")}</strong>
        <span>{market === "rental"
          ? "棟屋齡 1–10 年出租實登・已排除社宅"
          : zoneLevel ? "層級・再放大顯示建案" : detail ? "個符合建案"
          : `個${CITIES.length > 1 ? "全區" : "全市"}建案・點行政區開始探索`}</span>
      </div>
    </div>
  );
}
