-- 示範種子資料:讓專案不跑 ETL 也能起來。跑過 etl:all 後會被真資料覆蓋。
INSERT INTO district_stats (district, median_unit_price, median_rent_ping, est_roi, presale_count, rent_samples, is_demo) VALUES
('桃園區', 43.3, 740, 2.05, 128, 96, true),
('龜山區', 44.2, 865, 2.35, 87,  74, true),
('中壢區', 38.4, 672, 2.10, 143, 88, true),
('八德區', 36.1, 737, 2.45, 65,  52, true),
('蘆竹區', 35.2, 645, 2.20, 58,  41, true),
('大園區', 32.8, 588, 2.15, 46,  29, true),
('平鎮區', 30.5, 635, 2.50, 39,  33, true),
('楊梅區', 25.4, 540, 2.55, 31,  24, true),
('龍潭區', 24.8, 537, 2.60, 27,  18, true),
('大溪區', 23.5, 470, 2.40, 14,  11, true),
('觀音區', 21.2, 468, 2.65, 12,  8,  true),
('新屋區', 19.6, 441, 2.70, 7,   6,  true)
ON CONFLICT (district) DO NOTHING;

INSERT INTO projects (name, district, lat, lng, median_total, median_area, unit_price, est_rent, est_roi, rent_samples, deal_count, is_demo) VALUES
('擎天藝文', '桃園區', 24.9990, 121.3000, 2150, 31, 63.2, 33000, 1.84, 10, 22, true),
('樾中央',   '桃園區', 24.9812, 121.3055, 1720, 29, 53.6, 29000, 2.02, 11, 31, true),
('悅河灣',   '桃園區', 25.0062, 121.3208, 1650, 28, 53.2, 28000, 2.04, 9,  18, true),
('城心站前', '桃園區', 24.9895, 121.3125, 1450, 25, 52.0, 27500, 2.28, 15, 26, true),
('峰匯青埔', '中壢區', 25.0128, 121.2148, 1980, 33, 54.5, 32000, 1.94, 14, 40, true),
('鉑麗海華', '中壢區', 24.9645, 121.2168, 1560, 27, 52.0, 27000, 2.08, 12, 15, true),
('灣岸A19',  '大園區', 25.0335, 121.2260, 1690, 30, 50.7, 28500, 2.02, 7,  12, true),
('山王A7',   '龜山區', 25.0216, 121.3654, 1280, 26, 43.8, 26500, 2.48, 17, 55, true),
('鉑悅A7',   '龜山區', 25.0180, 121.3700, 1350, 28, 43.0, 27000, 2.40, 17, 38, true),
('大砌八德', '八德區', 24.9460, 121.2965, 1180, 27, 38.9, 24500, 2.49, 13, 20, true),
('觀止大湳', '八德區', 24.9585, 121.3120, 1250, 26, 42.9, 25000, 2.40, 3,  9,  true),
('平鎮心',   '平鎮區', 24.9450, 121.2180,  990, 25, 34.8, 21000, 2.55, 8,  14, true),
('埔心之丘', '楊梅區', 24.9210, 121.1660,  880, 24, 32.1, 18500, 2.52, 6,  10, true)
ON CONFLICT (name, district) DO NOTHING;

-- 示範用「排除社宅」口徑:以混合值粗放大(真資料由 compute-stats 重算)
UPDATE district_stats SET
  median_rent_ping_market = round(median_rent_ping * 1.9),
  est_roi_market          = round((est_roi * 1.9)::numeric, 2),
  rent_samples_market     = ceil(rent_samples * 0.4)
WHERE is_demo;
UPDATE projects SET
  est_rent_market     = round(est_rent * 1.9),
  est_roi_market      = round((est_roi * 1.9)::numeric, 2),
  rent_samples_market = ceil(rent_samples * 0.4)
WHERE is_demo;
