// Run in the Shell of quotation-web (docs/deploy.md): checks a database without psql.
//   cd /opt/tools && node db-check.mjs                 → the live database (DATABASE_URL)
//   cd /opt/tools && node db-check.mjs "<other URL>"   → e.g. a database restored for a drill
// Prints the database's default time zone (must be UTC) and row counts of the main tables.
import pg from "pg";

const url = process.argv[2] || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(2);
}
const db = new pg.Client({ connectionString: url });
await db.connect();
// Default for new sessions, set by the database_timezone_utc migration (the app also forces UTC per session).
const tz = await db.query(`
  SELECT coalesce((SELECT split_part(s, '=', 2) FROM pg_db_role_setting r, unnest(r.setconfig) s
                    WHERE r.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
                      AND r.setrole = 0 AND s LIKE 'TimeZone=%'), current_setting('TimeZone')) AS tz`);
console.log(`database time zone: ${tz.rows[0].tz}`);
for (const t of ["user", "company", "customer", "product", "quotation", "audit_log"]) {
  const r = await db.query(`SELECT count(*)::int AS n FROM "${t}"`).catch((e) => ({ rows: [{ n: `error: ${e.code}` }] }));
  console.log(`${t.padEnd(10)} ${r.rows[0].n}`);
}
await db.end();
