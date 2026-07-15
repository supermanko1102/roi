"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Map, { Source, Layer, Marker, Popup, MapRef } from "react-map-gl/maplibre";
import type { FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";

type Metric = "price" | "roi";
type Basis = "mix" | "market"; // 混合(含社宅)vs 排除社會住宅包租代管件
type BldgDeal = {
  address: string; deal_date: string | null;
  total_price: string; area_ping: string; unit_price: string | null;
};
type BldgPopup = {
  lng: number; lat: number;
  addr_key: string; deal_count: number; median_unit_price: number | null;
  building_type: string | null; build_year: number | null;
  deals: BldgDeal[] | null; // null = 載入中
};
type Project = {
  id: number; name: string; district: string;
  lat: string | null; lng: string | null;
  median_total: string; median_area: string; unit_price: string;
  est_rent: string | null; est_roi: string | null;
  est_rent_market: string | null; est_roi_market: string | null;
  rent_samples: number; rent_samples_market: number; deal_count: number;
};

// NLSC 台灣通用電子地圖(街道/地名最完整)raster style
const BASE_STYLE: any = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    emap: {
      type: "raster",
      tiles: ["https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}"],
      tileSize: 256,
      attribution: "© 內政部國土測繪中心・區界 © 內政部/g0v",
    },
  },
  layers: [{ id: "emap", type: "raster", source: "emap" }],
};

const PRICE_STOPS: [number, string][] = [[20, "#e2ebf5"], [32, "#7aa7cf"], [44, "#184a7c"]];
const ROI_STOPS: [number, string][] = [[1.8, "#d64541"], [2.2, "#e0a92e"], [2.6, "#2f9e6e"]];
// 市場件租金約為混合口徑兩倍,色階範圍跟著平移
const ROI_STOPS_MARKET: [number, string][] = [[2.6, "#d64541"], [3.4, "#e0a92e"], [5.0, "#2f9e6e"]];

const roiField = (basis: Basis) => (basis === "market" ? "est_roi_market" : "est_roi");
const roiStops = (basis: Basis) => (basis === "market" ? ROI_STOPS_MARKET : ROI_STOPS);

function fillExpr(metric: Metric, basis: Basis): any {
  const prop = metric === "price" ? "median_unit_price" : roiField(basis);
  const stops = metric === "price" ? PRICE_STOPS : roiStops(basis);
  return [
    "case",
    ["==", ["get", prop], null], "#cfd6da",
    ["interpolate", ["linear"], ["get", prop], ...stops.flat()],
  ];
}
function roiColor(v: number | null, basis: Basis): string {
  if (v == null) return "#9aa5ad";
  const s = roiStops(basis);
  if (v <= s[0][0]) return s[0][1];
  if (v >= s[2][0]) return s[2][1];
  return v < s[1][0] ? mix(s[0], s[1], v) : mix(s[1], s[2], v);
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
  const [metric, setMetric] = useState<Metric>("price");
  const [basis, setBasis] = useState<Basis>("mix");
  const [drilled, setDrilled] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [popup, setPopup] = useState<Project | null>(null);
  const [buildings, setBuildings] = useState<FeatureCollection | null>(null);
  const [bldgPopup, setBldgPopup] = useState<BldgPopup | null>(null);

  useEffect(() => {
    fetch("/api/districts").then((r) => r.json()).then(setDistricts);
  }, []);

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

  async function drill(name: string) {
    const feats = (districts?.features ?? []).find((f: any) => f.properties.name === name) as any;
    if (!feats) return;
    setDrilled(name);
    const [projRes, bldgRes] = await Promise.all([
      fetch(`/api/projects?district=${encodeURIComponent(name)}`),
      fetch(`/api/buildings?district=${encodeURIComponent(name)}`),
    ]);
    setProjects(await projRes.json());
    setBuildings(await bldgRes.json());
    const flat = JSON.stringify(feats.geometry.coordinates).match(/\[(-?[\d.]+),(-?[\d.]+)\]/g) ?? [];
    let minX = 180, maxX = 0, minY = 90, maxY = 0;
    for (const pt of flat) {
      const [x, y] = pt.slice(1, -1).split(",").map(Number);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    mapRef.current?.fitBounds([[minX, minY], [maxX, maxY]], { padding: 60, duration: 700 });
  }
  function back() {
    setDrilled(null); setProjects([]); setPopup(null);
    setBuildings(null); setBldgPopup(null);
    mapRef.current?.flyTo({ center: [121.25, 24.94], zoom: 10.3, duration: 700 });
  }

  async function openBuilding(f: any) {
    const p = f.properties;
    const [lng, lat] = f.geometry.coordinates;
    setBldgPopup({
      lng, lat, addr_key: p.addr_key, deal_count: p.deal_count,
      median_unit_price: p.median_unit_price ?? null,
      building_type: p.building_type ?? null, build_year: p.build_year ?? null,
      deals: null,
    });
    const res = await fetch(`/api/building-deals?addr=${encodeURIComponent(p.addr_key)}`);
    const deals = await res.json();
    setBldgPopup((cur) => (cur && cur.addr_key === p.addr_key ? { ...cur, deals } : cur));
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Map
        ref={mapRef}
        mapStyle={BASE_STYLE}
        initialViewState={{ longitude: 121.25, latitude: 24.94, zoom: 10.3 }}
        onClick={(e) => {
          const f = e.features?.[0];
          if (!f) return;
          if (f.layer.id === "bldg-cluster") {
            // 點 cluster → 展開放大
            const src: any = mapRef.current?.getSource("buildings");
            src?.getClusterExpansionZoom(f.properties!.cluster_id).then((z: number) =>
              mapRef.current?.easeTo({ center: (f.geometry as any).coordinates, zoom: z + 0.5, duration: 500 }));
          } else if (f.layer.id === "bldg-point") {
            openBuilding(f);
          } else if (!drilled) {
            drill((f.properties as any).name);
          }
        }}
        interactiveLayerIds={drilled ? ["bldg-cluster", "bldg-point"] : ["district-fill"]}
      >
        {districts && (
          <Source id="districts" type="geojson" data={districts}>
            <Layer id="district-fill" type="fill"
              paint={{ "fill-color": fillExpr(metric, basis) as any, "fill-opacity": 0.34 }} />
            <Layer id="district-line" type="line"
              paint={{ "line-color": "#2c5f8a", "line-width": 2 }} />
          </Source>
        )}

        {drilled && buildings && (
          <Source id="buildings" type="geojson" data={buildings}
            cluster clusterMaxZoom={15} clusterRadius={48}>
            <Layer id="bldg-cluster" type="circle" filter={["has", "point_count"]}
              paint={{
                "circle-color": "#3d7ea6",
                "circle-opacity": 0.85,
                "circle-radius": ["step", ["get", "point_count"], 14, 20, 19, 100, 25],
                "circle-stroke-width": 2, "circle-stroke-color": "#fff",
              }} />
            <Layer id="bldg-cluster-count" type="symbol" filter={["has", "point_count"]}
              layout={{
                "text-field": ["get", "point_count_abbreviated"],
                "text-font": ["Open Sans Semibold"], "text-size": 13,
              }}
              paint={{ "text-color": "#fff" }} />
            <Layer id="bldg-point" type="circle" filter={["!", ["has", "point_count"]]}
              paint={{
                "circle-color": [
                  "case", ["==", ["get", "median_unit_price"], null], "#9aa5ad",
                  ["interpolate", ["linear"], ["get", "median_unit_price"], ...PRICE_STOPS.flat()],
                ] as any,
                "circle-radius": 8,
                "circle-stroke-width": 2, "circle-stroke-color": "#fff",
              }} />
            <Layer id="bldg-price" type="symbol" filter={["!", ["has", "point_count"]]}
              minzoom={15}
              layout={{
                "text-field": ["concat", "$", ["to-string", ["get", "median_unit_price"]]],
                "text-font": ["Open Sans Semibold"], "text-size": 12,
                "text-offset": [0, 1.3], "text-anchor": "top",
                "text-optional": true,
              }}
              paint={{ "text-color": "#184a7c", "text-halo-color": "#fff", "text-halo-width": 1.6 }} />
          </Source>
        )}

        {!drilled && labels.map((l) => (
          <Marker key={l.name} longitude={l.lng} latitude={l.lat} anchor="center">
            <div
              className={`dlabel ${l.props.median_unit_price == null ? "nodata" : ""}`}
              onClick={(e) => { e.stopPropagation(); drill(l.name); }}
            >
              <span className="dname">{l.name}</span>
              <span className="dval num">
                {l.props.median_unit_price == null ? "資料不足"
                  : metric === "price" ? `$${(+l.props.median_unit_price).toFixed(1)}`
                  : l.props[roiField(basis)] == null ? "樣本不足" : `${(+l.props[roiField(basis)]).toFixed(2)}%`}
              </span>
            </div>
          </Marker>
        ))}

        {drilled && projects.filter((p) => p.lat && p.lng).map((p) => {
          const roiRaw = basis === "market" ? p.est_roi_market : p.est_roi;
          const roi = roiRaw == null ? null : +roiRaw;
          return (
            <Marker key={p.id} longitude={+p.lng!} latitude={+p.lat!} anchor="center">
              <div
                onClick={(e) => { e.stopPropagation(); setPopup(p); }}
                style={{
                  width: 20, height: 20, borderRadius: "50%",
                  background: roiColor(roi, basis), border: "2.5px solid #fff",
                  boxShadow: "0 1px 4px rgba(0,0,0,.3)", cursor: "pointer",
                }}
                title={p.name}
              />
            </Marker>
          );
        })}

        {popup && popup.lat && popup.lng && (() => {
          const roi = basis === "market" ? popup.est_roi_market : popup.est_roi;
          const rent = basis === "market" ? popup.est_rent_market : popup.est_rent;
          const samples = basis === "market" ? popup.rent_samples_market : popup.rent_samples;
          return (
            <Popup longitude={+popup.lng} latitude={+popup.lat} anchor="bottom"
              onClose={() => setPopup(null)} closeButton maxWidth="280px" offset={14}>
              <div className="popup-card">
                <h3>{popup.name}</h3>
                <div style={{ color: "var(--ink-soft)", fontSize: 11 }}>{popup.district}・{popup.deal_count} 筆成交</div>
                <div className="roi" style={{ background: roiColor(roi == null ? null : +roi, basis) }}>
                  <b className="num">{roi == null ? "—" : `${(+roi).toFixed(2)}%`}</b>
                  <span>推估年投報{basis === "market" ? "(排除社宅)" : ""}{samples < 5 ? "(樣本不足)" : ""}</span>
                </div>
                <dl>
                  <div><dt>中位總價</dt><dd className="num">{(+popup.median_total).toLocaleString()} 萬</dd></div>
                  <div><dt>中位坪數</dt><dd className="num">{(+popup.median_area).toFixed(1)} 坪</dd></div>
                  <div><dt>扣車位單價</dt><dd className="num">{(+popup.unit_price).toFixed(1)} 萬/坪</dd></div>
                  <div><dt>推估月租</dt><dd className="num">{rent ? (+rent).toLocaleString() + " 元" : "—"}</dd></div>
                </dl>
                <div className="note">租金推估:區內租賃中位數 × 坪數 × 0.85(n={samples}{basis === "market" ? ",排除社宅包租代管件" : ",含社宅件"})</div>
              </div>
            </Popup>
          );
        })()}
        {bldgPopup && (
          <Popup longitude={bldgPopup.lng} latitude={bldgPopup.lat} anchor="bottom"
            onClose={() => setBldgPopup(null)} closeButton maxWidth="320px" offset={12}>
            <div className="popup-card">
              <h3>{bldgPopup.addr_key.replace(/^桃園市[^區]+區/, "")}</h3>
              <div style={{ color: "var(--ink-soft)", fontSize: 11 }}>
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
            </div>
          </Popup>
        )}
      </Map>

      <div id="topbar">
        <span className="title">桃園預售屋投報率地圖</span>
        <div className="toggle" role="group">
          <button className={metric === "price" ? "on" : ""} onClick={() => setMetric("price")}>預售單價</button>
          <button className={metric === "roi" ? "on" : ""} onClick={() => setMetric("roi")}>推估投報率</button>
        </div>
        {(metric === "roi" || drilled) && (
          <div className="toggle" role="group" title="社會住宅包租代管件租金受政策壓低,約為市場價一半">
            <button className={basis === "mix" ? "on" : ""} onClick={() => setBasis("mix")}>含社宅</button>
            <button className={basis === "market" ? "on" : ""} onClick={() => setBasis("market")}>排除社宅</button>
          </div>
        )}
      </div>
      {drilled && <button className="backbtn" onClick={back}>← 返回全市</button>}
    </div>
  );
}
