/** Confirm the parser now extracts pool membership for ALL step types. */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import sql from 'mssql';
import { parseBpdXml } from '../src/external-bpm/bpd-xml-parser';

loadEnv({ path: resolve(__dirname, '..', '.env.webmethods') });

const KEY = process.argv[2] ?? 'DOEPetroleumProc/PermitProcess';
const VER = process.argv[3] ?? '4';
const DEP = Number(process.argv[4] ?? '13');

async function main() {
  const pool = await sql.connect({
    server: process.env.WEBMETHODS_DB_HOST!,
    port: Number(process.env.WEBMETHODS_DB_PORT) || 1433,
    database: process.env.WEBMETHODS_DB_NAME!,
    user: process.env.WEBMETHODS_DB_USER!,
    password: process.env.WEBMETHODS_DB_PASSWORD!,
    options: { encrypt: true, trustServerCertificate: true, readOnlyIntent: true },
  });

  const req = pool.request();
  req.input('key', sql.NVarChar(255), KEY);
  req.input('ver', sql.NVarChar(64), VER);
  req.input('dep', sql.Int, DEP);

  const xmlRes = await req.query(`
    SELECT PROCESSFILE FROM WMPROCESSDEFINITION
    WHERE PROCESSKEY = @key AND MODELVERSION = @ver AND DEPLOYMENTVERSION = @dep;
  `);
  const xml = (xmlRes.recordset[0].PROCESSFILE as Buffer).toString('utf8');

  const stepsRes = await pool.request()
    .input('key', sql.NVarChar(255), KEY)
    .input('ver', sql.NVarChar(64), VER)
    .input('dep', sql.Int, DEP)
    .query(`SELECT STEPID FROM WMSTEPDEFINITION WHERE PROCESSKEY = @key AND MODELVERSION = @ver AND DEPLOYMENTVERSION = @dep`);
  const dbStepIds = stepsRes.recordset.map((r) => r.STEPID);

  const map = parseBpdXml(xml);
  console.log(`Pools: ${map.pools.length}`);
  for (const p of map.pools) console.log(`  - ${p.id}: "${p.label}"`);

  // Count stepToPool entries per pool
  const counts: Record<string, number> = {};
  for (const [, poolId] of map.stepToPool) {
    counts[poolId] = (counts[poolId] ?? 0) + 1;
  }
  console.log('\nSteps assigned per pool (parser):');
  console.table(counts);

  console.log(`\nWMSTEPDEFINITION: ${dbStepIds.length} steps in DB`);
  console.log(`Parser knows pool for: ${map.stepToPool.size} step UIDs`);

  const dbSet = new Set(dbStepIds);
  const parserSet = new Set(map.stepToPool.keys());
  const dbNotInParser = [...dbSet].filter((s) => !parserSet.has(s));
  const parserNotInDb = [...parserSet].filter((s) => !dbSet.has(s));
  console.log(`In DB but no pool assigned (orphans): ${dbNotInParser.length}`);
  console.log(`  sample: ${dbNotInParser.slice(0, 8).join(', ')}`);
  console.log(`Parser knows but not in DB (XML-only, ignored): ${parserNotInDb.length}`);

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
