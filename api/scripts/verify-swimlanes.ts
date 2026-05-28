import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import sql from 'mssql';
import { parseBpdXml } from '/Users/vigneshmani/Documents/innovatech/bpm/api/src/external-bpm/bpd-xml-parser';
loadEnv({ path: resolve('/Users/vigneshmani/Documents/innovatech/bpm/api', '.env.webmethods') });
async function main() {
  const pool = await sql.connect({
    server: process.env.WEBMETHODS_DB_HOST!,
    port: Number(process.env.WEBMETHODS_DB_PORT) || 1433,
    database: process.env.WEBMETHODS_DB_NAME!,
    user: process.env.WEBMETHODS_DB_USER!,
    password: process.env.WEBMETHODS_DB_PASSWORD!,
    options: { encrypt: true, trustServerCertificate: true, readOnlyIntent: true },
  });
  const r = await pool.request()
    .input('key', sql.NVarChar(255), 'GasServicesProc/AMCProcess')
    .input('ver', sql.NVarChar(64), '1')
    .input('dep', sql.Int, 1)
    .query(`SELECT PROCESSFILE FROM WMPROCESSDEFINITION WHERE PROCESSKEY=@key AND MODELVERSION=@ver AND DEPLOYMENTVERSION=@dep`);
  const xml = (r.recordset[0].PROCESSFILE as Buffer).toString('utf8');
  const m = parseBpdXml(xml);
  console.log('Pools:', m.pools.length);
  console.log('Lanes (swimlanes):', m.lanes.length);
  for (const l of m.lanes) console.log(`  - ${l.id} "${l.label}" poolId=${l.poolId} y=${l.y} w=${l.width} h=${l.height}`);
  console.log('\nstepToLane size:', m.stepToLane.size);
  for (const [step, lane] of m.stepToLane) console.log(`  ${step} -> ${lane}`);
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
