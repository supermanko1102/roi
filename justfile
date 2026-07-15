# 起本地環境:DB → migration → 示範資料(dev server 自己跑 pnpm dev)
local-dev:
    docker compose up -d
    pnpm db:migrate
    pnpm db:seed

# 收掉本地環境(DB 資料保留在 volume,下次 local-dev 原樣回來)
local-down:
    docker compose down

# 連資料一起清掉(刪光 DB,含跑很久的 geocode 快取,慎用)
local-nuke:
    docker compose down -v
