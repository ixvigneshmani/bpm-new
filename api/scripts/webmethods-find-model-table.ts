/**
 * Second-pass discovery: figure out where the *real* process MODELS live.
 *
 * The user spotted that WMPROCESSDEFINITION has 3,056 rows but their
 * DOE project only has a handful of models — the labels look like
 * "PermitTask (38998)" / "PermitTask (38996)" — i.e. the parenthesised
 * number is probably an instance/version id, and we've been listing
 * runtime artifacts instead of source models.
 *
 * READ-ONLY. SELECTs only.
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import sql from 'mssql';

loadEnv({ path: resolve(__dirname, '..', '.env.webmethods') });

async function main() {
  const pool = await sql.connect({
    server: process.env.WEBMETHODS_DB_HOST!,
    port: Number(process.env.WEBMETHODS_DB_PORT) || 1433,
    database: process.env.WEBMETHODS_DB_NAME!,
    user: process.env.WEBMETHODS_DB_USER!,
    password: process.env.WEBMETHODS_DB_PASSWORD!,
    options: { encrypt: true, trustServerCertificate: true, readOnlyIntent: true },
  });

  // 1. EVERY table containing PROCESS / MODEL / INSTANCE / TASK in its name.
  console.log('\n[1] All process/model/instance/task tables in the DB:');
  const tables = await pool.request().query(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
      AND (
        TABLE_NAME LIKE '%PROCESS%' OR
        TABLE_NAME LIKE '%MODEL%' OR
        TABLE_NAME LIKE '%INSTANCE%' OR
        TABLE_NAME LIKE '%PRT%' OR
        TABLE_NAME LIKE '%TASK%'
      )
    ORDER BY TABLE_NAME;
  `);
  console.table(tables.recordset);

  // 2. Row counts for every WM* table — gives us a sense of which one is
  //    the small catalog (models) vs the big firehose (instances).
  console.log('\n[2] Row counts for every WM* table:');
  const wmTables = await pool.request().query(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME LIKE 'WM%'
    ORDER BY TABLE_NAME;
  `);
  const counts: { table: string; rows: number }[] = [];
  for (const t of wmTables.recordset) {
    try {
      const r = await pool.request().query(`SELECT COUNT(*) AS n FROM ${t.TABLE_NAME}`);
      counts.push({ table: t.TABLE_NAME, rows: r.recordset[0].n });
    } catch (e) {
      counts.push({ table: t.TABLE_NAME, rows: -1 });
    }
  }
  counts.sort((a, b) => b.rows - a.rows);
  console.table(counts);

  // 3. Strip the "(NNNNN)" suffix from PROCESSLABEL and count distinct
  //    base names. If the user's hunch is right, this collapses to a tiny
  //    number — confirming WMPROCESSDEFINITION is instance/version-level.
  console.log('\n[3] Distinct base labels in WMPROCESSDEFINITION (suffix stripped):');
  const baseLabels = await pool.request().query(`
    SELECT
      LTRIM(RTRIM(
        CASE
          WHEN PATINDEX('% (%)%', PROCESSLABEL) > 0
            THEN LEFT(PROCESSLABEL, PATINDEX('% (%)%', PROCESSLABEL) - 1)
          ELSE PROCESSLABEL
        END
      )) AS baseName,
      COUNT(*) AS n
    FROM WMPROCESSDEFINITION
    WHERE PROCESSLABEL IS NOT NULL
    GROUP BY
      LTRIM(RTRIM(
        CASE
          WHEN PATINDEX('% (%)%', PROCESSLABEL) > 0
            THEN LEFT(PROCESSLABEL, PATINDEX('% (%)%', PROCESSLABEL) - 1)
          ELSE PROCESSLABEL
        END
      ))
    ORDER BY n DESC;
  `);
  console.log(`  (${baseLabels.recordset.length} distinct base names)`);
  console.table(baseLabels.recordset.slice(0, 25));

  // 4. The PROCESSPATH column — webMethods often puts the model's
  //    namespace there (the user-authored "folder"). Distinct values
  //    of PROCESSPATH should also approximate "number of source models".
  console.log('\n[4] Distinct PROCESSPATH values in WMPROCESSDEFINITION:');
  const paths = await pool.request().query(`
    SELECT PROCESSPATH, COUNT(*) AS n
    FROM WMPROCESSDEFINITION
    GROUP BY PROCESSPATH
    ORDER BY n DESC;
  `);
  console.log(`  (${paths.recordset.length} distinct paths)`);
  console.table(paths.recordset.slice(0, 25));

  // 5. Peek at WMPROCESSINSTANCE if it exists — would confirm where
  //    instances actually live.
  const inst = tables.recordset.find((t) => t.TABLE_NAME === 'WMPROCESSINSTANCE');
  if (inst) {
    console.log('\n[5] WMPROCESSINSTANCE exists — columns:');
    const cols = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'WMPROCESSINSTANCE'
      ORDER BY ORDINAL_POSITION;
    `);
    console.table(cols.recordset);
    const ic = await pool.request().query('SELECT COUNT(*) AS n FROM WMPROCESSINSTANCE');
    console.log(`  row count: ${ic.recordset[0].n}`);
  }

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
