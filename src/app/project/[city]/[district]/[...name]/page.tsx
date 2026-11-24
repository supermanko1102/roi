import { cache } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import ProjectDrawer, { type PDetail } from "@/components/ProjectDrawer";
import { parseCity, validText } from "@/lib/api-params";
import { cityDisplay } from "@/lib/cities";
import { devLabel, devWord } from "@/lib/metrics-core";
import { loadProjectDetail } from "@/lib/project-detail";
import { projectMapPath, projectPath, siteUrl } from "@/lib/project-url";

// 建案獨立頁:伺服器端直出完整內容(可分享、可被搜尋),每小時重新產生一次。
// 內容與地圖抽屜是同一個元件、同一份資料,不會出現兩套口徑。
export const revalidate = 3600;
export async function generateStaticParams() { return []; }

type Params = { city: string; district: string; name: string[] };

const decode = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };

const load = cache(async (cityRaw: string, districtRaw: string, nameRaw: string) => {
  const city = parseCity(decode(cityRaw)).value;
  const district = decode(districtRaw);
  const name = decode(nameRaw);
  if (!city || !validText(district, 30) || !validText(name, 160)) return null;
  const detail = await loadProjectDetail(city, district, name);
  return detail ? { city, district, name, detail } : null;
});

const fromParams = (p: Params) => load(p.city, p.district, p.name.join("/"));

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const found = await fromParams(params);
  if (!found) return { title: "找不到這個建案｜房市探探" };
  const { city, district, name, detail } = found;
  const p = detail.project, m = detail.metrics;
  const place = `${cityDisplay(city)}${district}`;
  const price = p.unit_price == null ? "" : `一坪約 ${(+p.unit_price).toFixed(1)} 萬`;
  const facts = [
    price,
    p.median_total == null ? null : `一戶約 ${Math.round(+p.median_total).toLocaleString()} 萬`,
    `實價登錄 ${p.deal_count ?? 0} 筆成交`,
    m?.dev != null
      ? (devWord(m.dev) === "差不多" ? `和${m.dev_base}其他預售案差不多` : `比${m.dev_base}其他預售案${devLabel(m.dev)}`)
      : null,
    m?.yield_pct != null ? `租金回報約 ${m.yield_pct.toFixed(1)}%` : null,
    (p.cancel_count ?? 0) > 0 ? `解約 ${p.cancel_count} 筆` : null,
  ].filter(Boolean).join("、");
  const title = `${name}｜${place}預售屋實價登錄${price ? `・${price}` : ""}｜房市探探`;
  const description = `${place}「${name}」:${facts}。逐筆成交、棟別戶別、解約與租約紀錄,資料來源為內政部實價登錄。`;
  const url = `${siteUrl()}${projectPath(city, district, name)}`;
  return {
    title, description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "article", locale: "zh_TW", siteName: "房市探探" },
  };
}

export default async function ProjectPage({ params }: { params: Params }) {
  const found = await fromParams(params);
  if (!found) notFound();
  const { city, district, name, detail } = found;
  // 與 /api/project-detail 的 JSON 形狀一致(日期轉字串),元件不必分兩種輸入
  const initial = JSON.parse(JSON.stringify(detail)) as PDetail;
  const mapHref = projectMapPath(city, district, name, detail.project.lng, detail.project.lat);
  return (
    <div className="h-full overflow-y-auto bg-paper">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur-[14px]">
        <div className="mx-auto flex h-[58px] max-w-[760px] items-center gap-3 px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2.5 text-ink no-underline">
            <Image src="/brand/fangshi-tantan-logo-192.png" width={34} height={34} alt="" aria-hidden="true"
              className="size-[34px] flex-none object-contain" />
            <span className="text-[14px] font-extrabold tracking-[.04em]">房市探探</span>
          </Link>
          <Link href={mapHref}
            className="ml-auto inline-flex h-9 flex-none items-center rounded-[10px] bg-teal px-3.5 text-[11.5px] font-extrabold text-white no-underline">
            {detail.project.lat != null ? "在地圖上看這個建案" : "回地圖找其他建案"}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[760px] px-3 pb-14 pt-4 max-mob:px-0 max-mob:pt-0">
        <ProjectDrawer variant="page" city={city} district={district} name={name} initial={initial} />
      </main>
    </div>
  );
}
