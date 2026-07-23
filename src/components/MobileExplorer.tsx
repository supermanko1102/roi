"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, MapPin, Search, X } from "lucide-react";
import { CITIES, cityDisplay } from "@/lib/cities";
import { distanceToGeomM } from "@/lib/geo";
import { priceProp } from "@/lib/map-colors";
import type { MapLabel, ZoneFC } from "@/lib/map-types";
import type { ProjectSummary } from "./product-kit";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  districts: MapLabel[];
  zoneLabels: MapLabel[];
  zones: ZoneFC | null;
  projects: ProjectSummary[];
  selectedDistrictKey: string | null;
  selectedZoneKey: string | null;
  onChooseDistrict: (key: string) => void;
  onResetDistrict: () => void;
  onChooseZone: (key: string | null) => void;
  onChooseProject: (project: ProjectSummary) => void;
  loading: boolean;
};

const zoneDistricts = (label: MapLabel) =>
  String(label.props.district ?? "").split("/").map((name) => name.trim()).filter(Boolean);

export default function MobileExplorer({
  open, onClose, districts, zoneLabels, zones, projects,
  selectedDistrictKey, selectedZoneKey,
  onChooseDistrict, onResetDistrict, onChooseZone, onChooseProject, loading,
}: Props) {
  const [activeCity, setActiveCity] = useState(CITIES[0]?.name ?? "");
  const [needle, setNeedle] = useState("");
  const selectedDistrict = districts.find((district) => district.key === selectedDistrictKey) ?? null;

  useEffect(() => {
    const city = selectedDistrict?.props.city;
    if (city) setActiveCity(city);
  }, [selectedDistrict?.props.city]);

  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const project of projects) {
      const key = `${project.city}|${project.district}`;
      result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
  }, [projects]);

  const cityDistricts = useMemo(() => districts
    .filter((district) => district.props.city === activeCity && (counts.get(district.key) ?? 0) > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant")), [activeCity, counts, districts]);

  const districtZones = useMemo(() => {
    if (!selectedDistrict) return [];
    return zoneLabels.filter((zone) =>
      zone.props.city === selectedDistrict.props.city && zoneDistricts(zone).includes(selectedDistrict.name));
  }, [selectedDistrict, zoneLabels]);

  const selectedZone = zoneLabels.find((zone) => zone.key === selectedZoneKey) ?? null;

  const scopedProjects = useMemo(() => {
    if (!selectedDistrict) return [];
    let result = projects.filter((project) =>
      project.city === selectedDistrict.props.city && project.district === selectedDistrict.name);
    const query = needle.trim().toLocaleLowerCase("zh-Hant");
    if (query) result = result.filter((project) =>
      `${project.name} ${project.district}`.toLocaleLowerCase("zh-Hant").includes(query));
    const feature = selectedZoneKey ? zones?.features.find((zone) =>
      (zone.properties.zone_key ?? zone.properties.name) === selectedZoneKey) : null;
    if (feature) return result.sort((a, b) =>
      distanceToGeomM(a.lat, a.lng, feature.geometry) - distanceToGeomM(b.lat, b.lng, feature.geometry)
      || b.deals - a.deals || a.name.localeCompare(b.name, "zh-Hant"));
    return result.sort((a, b) => b.deals - a.deals || a.name.localeCompare(b.name, "zh-Hant"));
  }, [needle, projects, selectedDistrict, selectedZoneKey, zones]);

  const visibleLimit = selectedZone ? 24 : 80;
  const visibleProjects = scopedProjects.slice(0, visibleLimit);

  function chooseDistrict(key: string) {
    setNeedle("");
    onChooseDistrict(key);
  }

  function resetDistrict() {
    setNeedle("");
    onResetDistrict();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent showCloseButton={false}
        overlayClassName="z-70 bg-[#081c18]/36 supports-backdrop-filter:backdrop-blur-[2px] min-[721px]:hidden"
        className="bottom-0 left-0 top-auto z-70 block max-h-[82dvh] w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-b-none rounded-t-[24px] bg-surface px-3.5 pb-[calc(18px+env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-18px_60px_rgba(7,60,53,.22)] ring-0 min-[721px]:hidden data-open:slide-in-from-bottom-4">
        <div className="mx-auto mb-3 h-1 w-11 rounded-full bg-[#cad4d0]" aria-hidden="true" />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[9.5px] font-extrabold tracking-[.18em] text-teal">QUICK FIND</span>
            <DialogTitle className="mt-1 font-display text-[24px] font-bold leading-[1.05]">
              {selectedDistrict ? selectedDistrict.name : "不用縮放，直接找建案"}
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-[11.5px] leading-5 text-ink-soft">
              {selectedDistrict
                ? selectedZone
                  ? `${cityDisplay(String(selectedDistrict.props.city))}・先顯示離 ${selectedZone.name} 最近的建案`
                  : `${cityDisplay(String(selectedDistrict.props.city))}・${scopedProjects.length} 個符合建案`
                : "先選城市與行政區，地圖會自動移動到正確位置。"}
            </DialogDescription>
          </div>
          <DialogClose aria-label="關閉找建案"
            className="grid size-10 flex-none place-items-center rounded-full border-0 bg-muted text-ink-soft">
            <X className="size-4" />
          </DialogClose>
        </div>

        {!selectedDistrict ? (
          <>
            <div className="mb-4 grid grid-cols-3 rounded-[14px] bg-secondary p-1" role="tablist" aria-label="選擇城市">
              {CITIES.map((city) => (
                <button key={city.name} type="button" role="tab" aria-selected={activeCity === city.name}
                  onClick={() => setActiveCity(city.name)}
                  className={cn(
                    "h-10 rounded-[11px] border-0 text-[12px] font-extrabold transition",
                    activeCity === city.name
                      ? "bg-white text-teal shadow-[0_2px_10px_rgba(18,47,40,.10)]"
                      : "bg-transparent text-ink-soft",
                  )}>
                  {city.display}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2" aria-label={`${cityDisplay(activeCity)}行政區`}>
              {cityDistricts.map((district) => {
                const count = counts.get(district.key) ?? 0;
                const price = district.props[priceProp("presale")];
                return (
                  <button key={district.key} type="button" onClick={() => chooseDistrict(district.key)}
                    className="group flex min-h-[66px] items-center gap-2.5 rounded-[15px] border border-line bg-white px-3 py-2.5 text-left shadow-[0_3px_12px_rgba(18,47,40,.05)] transition active:scale-[.98]">
                    <span className="grid size-8 flex-none place-items-center rounded-full bg-mint text-teal">
                      <MapPin className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <b className="block truncate text-[13px]">{district.name}</b>
                      <span className="mt-1 block text-[10px] text-ink-soft">
                        {count} 案{price != null ? `・${(+price).toFixed(1)} 萬/坪` : ""}
                      </span>
                    </span>
                    <ChevronRight className="ml-auto size-4 flex-none text-[#9aa6a1] group-active:translate-x-0.5" />
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <button type="button" onClick={resetDistrict}
              className="mb-3 flex min-h-11 items-center gap-1 border-0 bg-transparent pr-3 text-[11.5px] font-extrabold text-teal">
              <ChevronLeft className="size-4" /> 換行政區
            </button>

            {districtZones.length > 0 && (
              <div className="mb-4">
                <div className="mb-2 text-[10px] font-extrabold tracking-[.08em] text-ink-soft">生活圈快速定位</div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  <button type="button" aria-pressed={!selectedZoneKey} onClick={() => onChooseZone(null)}
                    className="h-9 flex-none rounded-full border border-line bg-white px-3 text-[11px] font-bold text-ink aria-pressed:border-teal aria-pressed:bg-teal aria-pressed:text-white">
                    全區
                  </button>
                  {districtZones.map((zone) => (
                    <button key={zone.key} type="button" aria-pressed={selectedZoneKey === zone.key}
                      onClick={() => onChooseZone(zone.key)}
                      className="h-9 flex-none rounded-full border border-line bg-white px-3 text-[11px] font-bold text-ink aria-pressed:border-teal aria-pressed:bg-teal aria-pressed:text-white">
                      {zone.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="mb-3 flex h-11 items-center gap-2 rounded-[13px] border border-line bg-white px-3 focus-within:border-[#69a99c] focus-within:shadow-[0_0_0_3px_rgba(13,91,79,.08)]">
              <Search className="size-4 flex-none text-teal" aria-hidden="true" />
              <input value={needle} onChange={(event) => setNeedle(event.target.value)}
                className="w-full border-0 bg-transparent text-base outline-none placeholder:text-[#94a09c]"
                placeholder={`搜尋${selectedZone?.name ?? selectedDistrict.name}建案`}
                aria-label={`搜尋${selectedDistrict.name}建案`} />
              {needle && <button type="button" onClick={() => setNeedle("")}
                className="grid size-8 place-items-center border-0 bg-transparent text-ink-soft" aria-label="清除建案搜尋">
                <X className="size-3.5" />
              </button>}
            </label>

            <div className="mb-2 flex items-center justify-between">
              <strong className="text-[12px]">{selectedZone ? `${selectedZone.name}周邊優先` : "行政區全部建案"}</strong>
              <span className="num text-[10.5px] text-ink-soft">
                {selectedZone
                  ? `最近 ${Math.min(visibleLimit, scopedProjects.length)} / 全區 ${scopedProjects.length} 案`
                  : `${scopedProjects.length} 案`}
              </span>
            </div>

            {loading ? (
              <div className="grid min-h-32 place-items-center text-[12px] text-ink-soft">建案資料載入中…</div>
            ) : visibleProjects.length === 0 ? (
              <div className="rounded-[15px] border border-dashed border-line bg-[#faf9f5] px-5 py-9 text-center">
                <b className="text-[13px]">目前條件沒有建案</b>
                <p className="mt-1.5 text-[11px] leading-5 text-ink-soft">可切回全區、清除搜尋，或從下方「篩選」調整條件。</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-[16px] border border-line bg-white">
                {visibleProjects.map((project) => (
                  <button key={project.key} type="button" onClick={() => onChooseProject(project)}
                    className="group flex min-h-[70px] w-full items-center gap-3 border-0 border-b border-line/70 bg-white px-3 py-2.5 text-left last:border-b-0 active:bg-mint/50">
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[13px]">{project.name}</b>
                      <span className="mt-1 block truncate text-[10.5px] text-ink-soft">
                        {project.deals} 筆成交
                        {project.total != null ? `・總價約 ${Math.round(project.total).toLocaleString()} 萬` : ""}
                      </span>
                    </span>
                    <span className="num flex-none text-right">
                      <b className="block text-[13px] text-teal">{project.price == null ? "—" : project.price.toFixed(1)}</b>
                      <small className="text-[9px] text-ink-soft">萬／坪</small>
                    </span>
                    <ChevronRight className="size-4 flex-none text-[#9aa6a1] group-active:translate-x-0.5" />
                  </button>
                ))}
              </div>
            )}
            {scopedProjects.length > visibleProjects.length && (
              <p className="mt-2 text-center text-[10px] text-ink-soft">
                {selectedZone
                  ? `已依距離顯示最近的 ${visibleLimit} 案，可輸入名稱搜尋${selectedDistrict.name}全部建案。`
                  : "先顯示成交較多的 80 案，可輸入建案名稱繼續找。"}
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
