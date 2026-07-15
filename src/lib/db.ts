import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://roi:roi@localhost:5432/taoyuan_roi",
});
export default pool;
