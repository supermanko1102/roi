"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Map, { Marker, MapRef } from "react-map-gl/maplibre";
import MapLayers from "./map-layers";
import { PresalePopup, RentalPopup } from "./map-popups";
import ProjectDrawer from "./ProjectDrawer";
import RentalDrawer from "./RentalDrawer";
import MapLegend from "./MapLegend";
import MobileExplorer from "./MobileExplorer";
import {
  ComparePanel, FilterPanel, ProductHeader, ProjectListPanel,
  rentalSummaryFromFeature, summaryFromFeature,
  type MarketMode, type ProjectSummary, type RentalSummary,
} from "./product-kit";
import { type BandFilter } from "@/lib/age";
import { type RoomFilter } from "@/lib/rooms";
import { geomBbox } from "@/lib/geo";
import { priceProp } from "@/lib/map-colors";
import { CITIES, DEFAULT_VIEW } from "@/lib/cities";
import { addMapIcons } from "@/lib/map-icons";
import {
  CITY_LABEL_ZOOM, DETAIL_ZOOM, POINT_ZOOM, PROJECT_ZOOM, TOTAL_FILTERS, ZOOM_STEPS,
} from "@/lib/map-const";
import {
  buildSuggestions, enrichNearestTransport, filterPoints, sortSummaries, type ListSort, LIST_SORTS,
} from "@/lib/map-view";
import { cityDisplay } from "@/lib/cities";
import type {
  DistrictFC, MapLabel, PresaleFC, PresaleProps, RentalFC, RentalProps,
  ProjectIndexEntry, SearchSuggestion, StationFC, TransportStop, ZoneFC,
  Bounds, PillMode, PresalePopupData, RentalPopupData,
} from "@/lib/map-types";
import type { FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";

// 預售與租屋是兩個並列的瀏覽模式，不互相疊加。
// 本檔管狀態、URL 同步、資料載入與互動;圖層在 map-layers、彈窗在 map-popups、
// 純運算在 lib/map-view、門檻常數在 lib/map-const。

// OpenFreeMap Positron 淺色底圖:CARTO Positron 的開源重製版,免 API key 且允許生產使用
// (CARTO 免費圖磚自 2026-11 起要求 API key,磁磚會印上 API KEY REQUIRED 浮水印)
// 疊加圖層的 text-font 必須用此 style 的 glyphs 端點有的字型(Noto Sans 系列)
const BASE_STYLE = "https://tiles.openfreemap.org/styles/positron";

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
  const [districts, setDistricts] = useState<DistrictFC | null>(null);
  const band: BandFilter = "presale";
  const [market, setMarket] = useState<MarketMode>("presale");
  const [rooms, setRooms] = useState<RoomFilter>("all");
  const [totalBand, setTotalBand] = useState("all");
  const [householdMin, setHouseholdMin] = useState<number | null>(null);
  const [householdMax, setHouseholdMax] = useState<number | null>(null);
  const [nearMetro, setNearMetro] = useState(false);
  const [nearIC, setNearIC] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [activeOnly, setActiveOnly] = useState(false);
  const [pillMode, setPillMode] = useState<PillMode>("price");
  const [listOpen, setListOpen] = useState(false);
  const [listSort, setListSort] = useState<ListSort>("recent");
  const [scopeToView, setScopeToView] = useState(true);
  const [viewBounds, setViewBounds] = useState<Bounds | null>(null);
  const [zoom, setZoom] = useState(initialView.zoom);
  const [presalePopup, setPresalePopup] = useState<PresalePopupData | null>(null);
  const [zones, setZones] = useState<ZoneFC | null>(null);
  const [stations, setStations] = useState<StationFC | null>(null);
  const [rails, setRails] = useState<FeatureCollection | null>(null);
  const [rentals, setRentals] = useState<RentalFC | null>(null);
  const [rentalPopup, setRentalPopup] = useState<RentalPopupData | null>(null);
  const [catalog, setCatalog] = useState<PresaleFC | null>(null);
  const [projectIndex, setProjectIndex] = useState<ProjectIndexEntry[] | null>(null);
  const [drawerProj, setDrawerProj] = useState<{ city: string; district: string; name: string } | null>(null);
  const [rentalDrawerKey, setRentalDrawerKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [mobileDistrict, setMobileDistrict] = useState<string | null>(null);
  const [mobileZone, setMobileZone] = useState<string | null>(null);
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
    const readHouseholdBound = (key: string) => {
      const raw = qs.get(key);
      const value = raw == null ? NaN : Number(raw);
      return Number.isInteger(value) && value > 0 ? Math.min(value, 9_999) : null;
    };
    let initialHouseholdMin = readHouseholdBound("households_min");
    let initialHouseholdMax = readHouseholdBound("households_max");
    if (initialHouseholdMin != null && initialHouseholdMax != null
      && initialHouseholdMin > initialHouseholdMax)
      [initialHouseholdMin, initialHouseholdMax] = [initialHouseholdMax, initialHouseholdMin];
    const initialMarket: MarketMode = qs.get("market") === "rent" || qs.get("rent") === "1" ? "rental" : "presale";
    setRooms(initialRooms); setTotalBand(initialBudget);
    setHouseholdMin(initialHouseholdMin); setHouseholdMax(initialHouseholdMax); setMarket(initialMarket);
    setQuery(qs.get("q") ?? ""); setNearMetro(qs.get("metro") === "1"); setNearIC(qs.get("ic") === "1");
    setShowCancel(qs.get("cancel") === "1");
    setActiveOnly(qs.get("active") === "1");
    const show = qs.get("show");
    if (show === "dev" || show === "yield") setPillMode(show);
    const sortParam = qs.get("sort");
    if (LIST_SORTS.some((x) => x.key === sortParam)) setListSort(sortParam as ListSort);
    // 桌機預設攤開清單:先給答案(排序好的候選),地圖是輔助;?list=0 可關
    setListOpen(qs.get("list") === "1" || (qs.get("list") !== "0" && window.innerWidth >= 1100 && !qs.get("proj")));
    loadCatalog(initialRooms);
    loadProjectIndex();
    try {
      const local = JSON.parse(localStorage.getItem("roi-shortlist") ?? "[]");
      // 多城市之前存的比較清單沒有 city → 一律視為桃園市並重算 key
      if (Array.isArray(local)) setSaved(local.slice(0, 3).map((p: any) =>
        p.city ? p : { ...p, city: "桃園市", key: `桃園市|${p.district}|${p.name}` }));
    } catch { /* 忽略損壞的本機偏好 */ }
    // 深連結:?rentkey=社區/門牌鍵 直接開租賃抽屜(可分享)
    const rk = qs.get("rentkey");
    if (initialMarket === "rental" && rk) setRentalDrawerKey(rk);
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
      households: null,
      households_min: householdMin == null ? null : String(householdMin),
      households_max: householdMax == null ? null : String(householdMax),
      metro: nearMetro ? "1" : null, ic: nearIC ? "1" : null,
      cancel: showCancel ? "1" : null,
      active: activeOnly ? "1" : null,
      show: pillMode === "price" ? null : pillMode,
      sort: listSort === "recent" ? null : listSort,
      market: market === "rental" ? "rent" : null, rent: null, mode: null, view: null,
    });
  }, [urlReady, query, totalBand, householdMin, householdMax, rooms, nearMetro, nearIC, showCancel, activeOnly,
    pillMode, listSort, market]);

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
  // 租賃抽屜以地圖點 key 為鍵;明細 API 一次回傳市場+社宅
  function openRentalDrawer(key: string) {
    setRentalDrawerKey(key); setRentalPopup(null);
    syncUrl({ rentkey: key });
  }
  function closeRentalDrawer() {
    setRentalDrawerKey(null);
    syncUrl({ rentkey: null });
  }

  // 全量建案點位一次載入(約 3 千點),地圖、清單、搜尋共用同一份;
  // 不再按視窗 bbox 另抓——每個 bbox 都是獨立快取鍵,幾乎必打到資料庫,反而慢。
  async function loadCatalog(room: RoomFilter) {
    const res = await fetch(`/api/points?kind=presale${room !== "all" ? `&rooms=${room}` : ""}`);
    if (res.ok) setCatalog(await res.json());
  }

  async function loadProjectIndex() {
    const res = await fetch("/api/project-index");
    if (res.ok) setProjectIndex(await res.json());
  }

  useEffect(() => {
    if (!pointsVisible) setPresalePopup(null);
  }, [pointsVisible]);

  useEffect(() => {
    if (market !== "rental") { setRentalPopup(null); return; }
    if (!rentals) fetch("/api/rentals").then((r) => r.json()).then(setRentals);
  }, [market, rentals]);

  // 切格局:點位口徑整個換掉(價格/總價/筆數改用該房數帶),重抓全量 catalog
  function pickRooms(r: RoomFilter) {
    setRooms(r); setPresalePopup(null);
    loadCatalog(r);
  }

  // 車站/交流道索引(最近距離用;stations.geojson 用 kind 區分)
  const transportIdx = useMemo<TransportStop[]>(() => (stations?.features ?? []).map((f) => ({
    name: f.properties.name, line: f.properties.line, status: f.properties.status,
    kind: f.properties.kind ?? "station",
    lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
  })), [stations]);
  const railIdx = useMemo(() => transportIdx.filter((t) => t.kind === "station"), [transportIdx]);
  const icIdx = useMemo(() => transportIdx.filter((t) => t.kind === "interchange"), [transportIdx]);

  // 同一套交通距離同時餵地圖點位與搜尋建議
  const enrichedCatalog = useMemo(() => enrichNearestTransport(catalog, railIdx, icIdx), [catalog, railIdx, icIdx]);
  const pointFilter = useMemo(
    () => ({ totalBand, householdMin, householdMax, query, nearMetro, nearIC, activeOnly }),
    [totalBand, householdMin, householdMax, query, nearMetro, nearIC, activeOnly],
  );
  const visibleCatalog = useMemo(() => filterPoints(enrichedCatalog, pointFilter), [enrichedCatalog, pointFilter]);
  const projectSummaries = useMemo(() => (visibleCatalog?.features ?? [])
    .map(summaryFromFeature)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant")), [visibleCatalog]);
  // 桌機清單:篩選後 →(可選)限縮到目前地圖範圍 → 依選定的問題排序
  const listProjects = useMemo(() => {
    const scoped = scopeToView && viewBounds
      ? projectSummaries.filter((p) =>
          p.lng >= viewBounds[0] && p.lng <= viewBounds[2] && p.lat >= viewBounds[1] && p.lat <= viewBounds[3])
      : projectSummaries;
    return sortSummaries(scoped, listSort);
  }, [projectSummaries, scopeToView, viewBounds, listSort]);
  // 市場件與社宅件分成兩個 Source:各自 cluster、各自配色,社宅不混進市場行情視覺
  const marketRentals = useMemo(() => rentals && ({
    ...rentals, features: rentals.features.filter((f) => !f.properties.is_social),
  }), [rentals]);
  const socialRentals = useMemo(() => rentals && ({
    ...rentals, features: rentals.features.filter((f) => f.properties.is_social),
  }), [rentals]);
  const rentalSummaries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-Hant");
    return (rentals?.features ?? [])
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
  const activeFilters = +(totalBand !== "all") + +(householdMin != null || householdMax != null)
    + +(rooms !== "all") + +nearMetro + +nearIC + +showCancel + +activeOnly;

  // 解約標記:獨立於屋齡帶篩選,永遠拿全部點位過濾
  const cancelPoints = useMemo(() => {
    if (!catalog) return null;
    return { ...catalog, features: catalog.features.filter((f) => (f.properties.cancel_count ?? 0) > 0) };
  }, [catalog]);

  // 標籤放邊界框中心(粗略但夠用;更準可預算 pole of inaccessibility)
  // key=城市|區名:跨市撞區名(如中正區)時識別用,顯示仍用 name
  const labels = useMemo<MapLabel[]>(() => {
    if (!districts) return [];
    return districts.features.map((f) => {
      const [w, s, e, n] = geomBbox(f.geometry);
      return {
        key: `${f.properties.city}|${f.properties.name}`,
        name: f.properties.name, lng: (w + e) / 2, lat: (s + n) / 2, props: f.properties,
      };
    });
  }, [districts]);

  // 重劃區標籤同樣放邊界框中心(邊界是官方圖資的 Polygon/MultiPolygon)
  const zoneLabels = useMemo<MapLabel[]>(() => {
    if (!zones) return [];
    return zones.features.map((f) => {
      const [w, s, e, n] = geomBbox(f.geometry);
      return {
        key: f.properties.zone_key ?? f.properties.name,
        name: f.properties.name, lng: (w + e) / 2, lat: (s + n) / 2,
        bounds: [[w, s], [e, n]] as [[number, number], [number, number]],
        props: f.properties,
      };
    });
  }, [zones]);

  const suggestions = useMemo(() => buildSuggestions({
    query, market, catalog, projectIndex, rentals, zoneLabels, districtLabels: labels,
  }), [query, market, catalog, projectIndex, rentals, zoneLabels, labels]);

  function pickSuggestion(s: SearchSuggestion) {
    setQuery(""); // 選中即導航:query 是導航輸入,不留著當篩選
    setExploreOpen(false);
    if (s.kind === "project") {
      const f = catalog?.features.find(
        (x) => `${x.properties.city}|${x.properties.district}|${x.properties.name}` === s.key);
      if (f) { openSummary(summaryFromFeature(f)); return; }
      // 無座標案(工地位置為路段/地號):不飛地圖,直接開抽屜看行情
      const [city, district, ...rest] = s.key.split("|");
      if (city && district && rest.length) openProjDrawer(city, district, rest.join("|"));
    } else if (s.kind === "zone") {
      zoomToZone(s.key);
    } else if (s.kind === "district") {
      drill(s.key);
    } else {
      const f = rentals?.features.find((x) => x.properties.key === s.key);
      if (f) openRentalSummary(rentalSummaryFromFeature(f));
    }
  }

  function zoomToZone(zoneKey: string) {
    const z = zoneLabels.find((l) => l.key === zoneKey);
    if (!z?.bounds) return;
    setMobileZone(zoneKey);
    const names = String(z.props.district ?? "").split("/").map((name) => name.trim());
    if (!mobileDistrict || !names.includes(mobileDistrict.split("|").at(-1) ?? ""))
      setMobileDistrict(labels.find((label) =>
        label.props.city === z.props.city && names.includes(label.name))?.key ?? null);
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

  // 點行政區 → 縮放到該區;顯示什麼由 zoom 門檻決定,與滾輪放大走同一條路
  function drill(key: string) {
    const feat = (districts?.features ?? [])
      .find((f) => `${f.properties.city}|${f.properties.name}` === key);
    if (!feat) return;
    setMobileDistrict(key);
    setMobileZone(null);
    const [w, s, e, n] = geomBbox(feat.geometry);
    // 面積大的區 fitBounds 後可能還不到細節門檻,保底跨過去
    const map = mapRef.current?.getMap();
    const cam = map?.cameraForBounds([[w, s], [e, n]], { padding: 60 });
    if (map && cam) map.easeTo({ ...cam, zoom: Math.max(cam.zoom ?? DETAIL_ZOOM, DETAIL_ZOOM + 0.1), duration: 700 });
  }
  function back() {
    setMobileDistrict(null);
    setMobileZone(null);
    mapRef.current?.flyTo({
      center: [DEFAULT_VIEW.longitude, DEFAULT_VIEW.latitude],
      zoom: DEFAULT_VIEW.zoom, duration: 700,
    });
  }

  function openPoint(f: any) {
    const p = f.properties as PresaleProps;
    // 抽屜開著時點別的建案直接切換內容,維持「掃描→查看→再掃描」的節奏
    if (drawerProj) { openProjDrawer(p.city, p.district, p.name!); return; }
    const [lng, lat] = f.geometry.coordinates;
    setPresalePopup({
      lng, lat, name: p.name!, city: p.city, district: p.district, deal_count: p.deal_count,
      price: p.price ?? null, median_total: p.median_total ?? null,
      median_area: p.median_area ?? null, band: p.band, build_year: p.build_year ?? null,
      cancel_count: p.cancel_count ?? 0,
      dev: p.dev ?? null, dev_base: p.dev_base ?? null,
      yield_pct: p.yield_pct ?? null, yield_src: p.yield_src ?? null,
      recent_n: p.recent_n ?? 0,
      st_name: p.st_name ?? null, st_line: p.st_line ?? null, st_m: p.st_m ?? null,
      ic_name: p.ic_name ?? null, ic_m: p.ic_m ?? null,
    });
  }

  function openRental(f: any) {
    const p = f.properties as RentalProps, [lng, lat] = f.geometry.coordinates;
    setPresalePopup(null);
    // 抽屜開著時點別的租賃點直接切換內容,與預售「掃描→查看→再掃描」同節奏
    if (rentalDrawerKey) { openRentalDrawer(p.key); return; }
    setRentalPopup({
      lng, lat, key: p.key, name: p.name ?? null, district: p.district, address: p.address,
      building_type: p.building_type, build_year: +p.build_year, age: +p.age,
      monthly_rent: +p.monthly_rent, area_ping: +p.area_ping,
      housing_rent: +(p.housing_rent ?? p.monthly_rent),
      parking_rent: p.parking_rent == null ? null : +p.parking_rent,
      rent_per_ping: +p.rent_per_ping, deal_count: +p.deal_count,
      last_deal: p.last_deal ?? null,
      doors: +(p.doors ?? 1), is_social: p.is_social === true,
      social_count: +(p.social_count ?? 0),
    });
  }

  function openSummary(p: ProjectSummary) {
    setExploreOpen(false);
    setCompareOpen(false);
    mapRef.current?.flyTo({ center: [p.lng, p.lat], zoom: PROJECT_ZOOM, duration: 650 });
    openProjDrawer(p.city, p.district, p.name);
  }

  function openRentalSummary(r: RentalSummary) {
    mapRef.current?.flyTo({ center: [r.lng, r.lat], zoom: PROJECT_ZOOM, duration: 650 });
    setRentalPopup({
      lng: r.lng, lat: r.lat, key: r.key, name: r.name, district: r.district, address: r.address,
      building_type: r.buildingType, build_year: new Date().getFullYear() - r.age, age: r.age,
      monthly_rent: r.monthlyRent, housing_rent: r.housingRent, parking_rent: r.parkingRent,
      area_ping: r.area, rent_per_ping: r.rentPerPing, deal_count: r.deals, last_deal: r.lastDeal,
      doors: r.doors, is_social: r.isSocial, social_count: r.socialCount,
    });
  }

  function changeMarket(next: MarketMode) {
    setMarket(next);
    setQuery("");
    setFiltersOpen(false);
    setExploreOpen(false);
    setPresalePopup(null);
    setRentalPopup(null);
    if (next === "rental") closeProjDrawer();
    if (next === "presale") closeRentalDrawer();
  }

  function toggleSaved(p: ProjectSummary) {
    setSaved((current) => {
      if (current.some((x) => x.key === p.key)) return current.filter((x) => x.key !== p.key);
      if (current.length >= 3) { setCompareOpen(true); return current; }
      return [...current, p];
    });
  }

  function resetFilters() {
    setTotalBand("all"); setHouseholdMin(null); setHouseholdMax(null);
    pickRooms("all"); setNearMetro(false); setNearIC(false);
    setShowCancel(false); setActiveOnly(false);
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
          const b0 = e.target.getBounds();
          setViewBounds([b0.getWest(), b0.getSouth(), b0.getEast(), b0.getNorth()]);
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
          const vb = e.target.getBounds();
          setViewBounds([vb.getWest(), vb.getSouth(), vb.getEast(), vb.getNorth()]);
          syncUrl({
            lng: e.viewState.longitude.toFixed(5), lat: e.viewState.latitude.toFixed(5),
            z: e.viewState.zoom.toFixed(2),
          });
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
            ...(market === "rental" ? [
              "rent-cluster", "rent-point", "rent-symbol", "rent-label",
              "rent-social-cluster", "rent-social-point", "rent-social-symbol", "rent-social-label",
            ] : []),
          ].filter((l) => map.getLayer(l));
          const f = clickable.length ? map.queryRenderedFeatures(e.point, { layers: clickable })[0] : undefined;
          if (!f) return;
          if (market === "rental" && ["rent-cluster", "rent-social-cluster"].includes(f.layer.id)) {
            const src: any = mapRef.current?.getSource(
              f.layer.id === "rent-social-cluster" ? "rentals-social" : "rentals");
            src?.getClusterExpansionZoom(f.properties!.cluster_id).then((z: number) =>
              mapRef.current?.easeTo({ center: (f.geometry as any).coordinates, zoom: z + 0.4, duration: 500 }));
          } else if (market === "rental" && f.layer.id.startsWith("rent-")) {
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
          ...(market === "rental" ? [
            "rent-cluster", "rent-point", "rent-symbol", "rent-label",
            "rent-social-cluster", "rent-social-point", "rent-social-symbol", "rent-social-label",
          ] : []),
        ]}
      >
        <MapLayers districts={districts} zones={zones} market={market}
          marketRentals={marketRentals} socialRentals={socialRentals}
          points={pointsVisible ? visibleCatalog : null} cancelPoints={showCancel && pointsVisible ? cancelPoints : null}
          pillMode={pillMode} rooms={rooms} rails={detail ? rails : null} stations={detail ? stations : null} />

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

        {market === "presale" && presalePopup && (
          <PresalePopup popup={presalePopup} onClose={() => setPresalePopup(null)}
            onOpen={() => openProjDrawer(presalePopup.city, presalePopup.district, presalePopup.name)} />
        )}
        {rentalPopup && (
          <RentalPopup popup={rentalPopup} onClose={() => setRentalPopup(null)}
            onOpen={() => openRentalDrawer(rentalPopup.key)} />
        )}
      </Map>

      <ProductHeader market={market} setMarket={changeMarket}
        query={query} setQuery={setQuery} suggestions={suggestions} onPick={pickSuggestion}
        exploreOpen={exploreOpen} toggleExplore={() => {
          setExploreOpen((current) => !current);
          setFiltersOpen(false);
        }}
        listOpen={listOpen} toggleList={() => setListOpen((current) => !current)}
        filtersOpen={filtersOpen} setFiltersOpen={(open) => {
          setFiltersOpen(open);
          if (open) setExploreOpen(false);
        }}
        activeFilters={activeFilters} savedCount={saved.length} openCompare={() => {
          setExploreOpen(false);
          setCompareOpen(true);
        }}
        share={shareCurrent} shared={shared} />

      {market === "presale" && <MobileExplorer open={exploreOpen} onClose={() => setExploreOpen(false)}
        districts={labels} zoneLabels={zoneLabels} zones={zones} projects={projectSummaries}
        selectedDistrictKey={mobileDistrict} selectedZoneKey={mobileZone} loading={catalog == null}
        onChooseDistrict={drill}
        onResetDistrict={() => { setMobileDistrict(null); setMobileZone(null); }}
        onChooseZone={(key) => {
          setMobileZone(key);
          if (key) zoomToZone(key);
          else if (mobileDistrict) drill(mobileDistrict);
        }}
        onChooseProject={openSummary} sort={listSort} setSort={setListSort} />}

      {market === "presale" && <ProjectListPanel open={listOpen} onClose={() => setListOpen(false)}
        projects={listProjects} total={projectSummaries.length} loading={catalog == null}
        sort={listSort} setSort={setListSort} scopeToView={scopeToView} setScopeToView={setScopeToView}
        onOpen={openSummary} multiCity={(city) => (CITIES.length > 1 ? cityDisplay(city) : undefined)} />}

      {market === "presale" && <FilterPanel open={filtersOpen}
        totalBand={totalBand} setTotalBand={(v) => { setTotalBand(v); setPresalePopup(null); }}
        householdMin={householdMin} householdMax={householdMax}
        setHouseholdRange={(min, max) => {
          setHouseholdMin(min); setHouseholdMax(max); setPresalePopup(null);
        }}
        rooms={rooms} setRooms={pickRooms} nearMetro={nearMetro} setNearMetro={setNearMetro}
        nearIC={nearIC} setNearIC={setNearIC} showCancel={showCancel} setShowCancel={setShowCancel}
        activeOnly={activeOnly} setActiveOnly={(v) => { setActiveOnly(v); setPresalePopup(null); }}
        reset={resetFilters} />}

      <ComparePanel open={market === "presale" && compareOpen} saved={saved} onClose={() => setCompareOpen(false)}
        onRemove={toggleSaved} onOpen={openSummary} />

      {rentalDrawerKey && <RentalDrawer rentalKey={rentalDrawerKey}
        onClose={closeRentalDrawer}
        onOpenProject={(pj) => { closeRentalDrawer(); openProjDrawer(pj.city, pj.district, pj.name); }} />}

      {drawerProj && <ProjectDrawer city={drawerProj.city} district={drawerProj.district} name={drawerProj.name}
        onClose={closeProjDrawer}
        saved={saved.some((p) => p.key === `${drawerProj.city}|${drawerProj.district}|${drawerProj.name}`)}
        onToggleSaved={() => {
          const found = enrichedCatalog?.features.find(
            (f) => `${f.properties.city}|${f.properties.district}|${f.properties.name}` ===
              `${drawerProj.city}|${drawerProj.district}|${drawerProj.name}`);
          if (found) toggleSaved(summaryFromFeature(found));
        }} />}

      <MapLegend market={market} rooms={rooms} nearMetro={nearMetro} nearIC={nearIC}
        detail={detail} showStations={stations != null}
        pillMode={pillMode} setPillMode={setPillMode} shifted={market === "presale" && listOpen} />

      {detail && <button className={`backbtn ${market === "presale" && listOpen ? "with-list" : ""}`} onClick={back}>← 返回{CITIES.length > 1 ? "全區" : "全市"}</button>}
      <div className="map-status">
        <strong>{market === "rental" ? rentalSummaries.length : zoneLevel ? "生活圈" : (projectSummaries.length || "—")}</strong>
        <span>{market === "rental"
          ? "棟屋齡 1–10 年出租實登・已排除社宅"
          : zoneLevel ? "層級・點生活圈或用「找建案」" : detail ? "個符合建案"
          : `個${CITIES.length > 1 ? "全區" : "全市"}建案・點行政區開始探索`}</span>
      </div>
    </div>
  );
}
