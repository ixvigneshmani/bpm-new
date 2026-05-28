/**
 * One-shot discovery script: connect read-only to the webMethods MSSQL DB and
 * print enough info to build the External BPM preview feature.
 *
 *   - Sanity check: SELECT 1
 *   - Distinct TYPE values in WMSTEPDEFINITION + a sample row for each
 *   - Distinct TYPE values in WMPROCESSDEFINITION + a sample row for each
 *
 * Run: tsx scripts/webmethods-discovery.ts
 * Reads creds from api/.env.webmethods (gitignored). NEVER writes to the DB.
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import sql from 'mssql';

loadEnv({ path: resolve(__dirname, '..', '.env.webmethods') });

const {
  WEBMETHODS_DB_HOST,
  WEBMETHODS_DB_PORT,
  WEBMETHODS_DB_NAME,
  WEBMETHODS_DB_USER,
  WEBMETHODS_DB_PASSWORD,
} = process.env;

if (
  !WEBMETHODS_DB_HOST ||
  !WEBMETHODS_DB_NAME ||
  !WEBMETHODS_DB_USER ||
  !WEBMETHODS_DB_PASSWORD
) {
  console.error('Missing WEBMETHODS_DB_* env vars. Check api/.env.webmethods');
  process.exit(1);
}

async function main() {
  console.log(
    `Connecting to ${WEBMETHODS_DB_HOST}:${WEBMETHODS_DB_PORT}/${WEBMETHODS_DB_NAME} as ${WEBMETHODS_DB_USER} (read-only intent)…`,
  );

  const pool = await sql.connect({
    server: WEBMETHODS_DB_HOST!,
    port: Number(WEBMETHODS_DB_PORT) || 1433,
    database: WEBMETHODS_DB_NAME!,
    user: WEBMETHODS_DB_USER!,
    password: WEBMETHODS_DB_PASSWORD!,
    options: {
      encrypt: true,
      trustServerCertificate: true,
      readOnlyIntent: true,
    },
    requestTimeout: 30000,
  });

  // 1. Sanity check
  const ping = await pool.request().query('SELECT 1 AS ok');
  console.log('\n[1] Sanity SELECT 1 →', ping.recordset[0]);

  // 2. Distinct step TYPE values + a sample row per type (label, component icon,
  //    is_start/is_stop) so we can map them to BPMN shapes.
  const stepTypes = await pool.request().query(`
    SELECT TYPE,
           COUNT(*) AS n,
           SUM(CAST(IS_START AS INT)) AS n_start,
           SUM(CAST(IS_STOP  AS INT)) AS n_stop
    FROM WMSTEPDEFINITION
    GROUP BY TYPE
    ORDER BY n DESC;
  `);
  console.log('\n[2a] WMSTEPDEFINITION — distinct TYPE values:');
  console.table(stepTypes.recordset);

  // For each TYPE, grab up to 3 sample labels + COMPONENT (icon filename) so
  // we can guess what kind of node it is.
  const types = stepTypes.recordset.map((r) => r.TYPE);
  for (const t of types) {
    const samples = await pool
      .request()
      .input('t', sql.SmallInt, t)
      .query(`
        SELECT TOP 5 TYPE, STEPLABEL, COMPONENT, IS_START, IS_STOP
        FROM WMSTEPDEFINITION
        WHERE TYPE = @t
        ORDER BY STEPLABEL;
      `);
    console.log(`\n[2b] Samples for TYPE=${t}:`);
    console.table(samples.recordset);
  }

  // 3. Process-level TYPE — for completeness.
  const procTypes = await pool.request().query(`
    SELECT TYPE, COUNT(*) AS n
    FROM WMPROCESSDEFINITION
    GROUP BY TYPE
    ORDER BY n DESC;
  `);
  console.log('\n[3] WMPROCESSDEFINITION — distinct TYPE values:');
  console.table(procTypes.recordset);

  // 4. Transition TYPE / VISUALTYPE — to spot conditional vs default edges.
  const txTypes = await pool.request().query(`
    SELECT TYPE, VISUALTYPE, COUNT(*) AS n
    FROM WMSTEPTRANSITIONDEFINITION
    GROUP BY TYPE, VISUALTYPE
    ORDER BY n DESC;
  `);
  console.log('\n[4] WMSTEPTRANSITIONDEFINITION — TYPE / VISUALTYPE:');
  console.table(txTypes.recordset);

  await pool.close();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Discovery failed:', err);
  process.exit(1);
});
