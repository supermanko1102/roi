# 本地開發一條龍:起 DB → 套 migration → 塞示範資料 → 起 Next dev
local-dev:
    docker compose up -d
    npm run db:migrate
    npm run db:seed
    npm run dev

# 收掉本地環境(DB 資料保留在 volume,下次 local-dev 原樣回來)
local-down:
    docker compose down

# 連資料一起清掉(刪光 DB,含跑很久的 geocode 快取,慎用)
local-nuke:
    docker compose down -v
