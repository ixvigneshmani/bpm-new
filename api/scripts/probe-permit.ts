import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import sql from 'mssql';
import { parseBpdXml } from '../src/external-bpm/bpd-xml-parser';
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
  const r = await pool.request()
    .input('key', sql.NVarChar(255), 'DOEPetroleumProc/PermitProcess')
    .input('ver', sql.NVarChar(64), '4').input('dep', sql.Int, 13)
    .query(`SELECT PROCESSFILE FROM WMPROCESSDEFINITION WHERE PROCESSKEY=@key AND MODELVERSION=@ver AND DEPLOYMENTVERSION=@dep`);
  const xml = (r.recordset[0].PROCESSFILE as Buffer).toString('utf8');
  console.log('Raw counts:');
  console.log('  <swimlane> tags:', (xml.match(/<swimlane\b/g) ?? []).length);
  console.log('  <pool> tags:', (xml.match(/<pool\b/g) ?? []).length);
  const m = parseBpdXml(xml);
  console.log('\nParser output:');
  console.log('  Pools:', m.pools.length);
  console.log('  Lanes (swimlanes):', m.lanes.length);
  for (const l of m.lanes) console.log(`    - ${l.id} "${l.label}" poolId=${l.poolId} y=${l.y} h=${l.height}`);
  console.log('  Steps→swimlane:', m.stepToLane.size);
  console.log('  Steps→pool:', m.stepToPool.size);
  // Show sample step assignments + their X/Y
  console.log('\nSample step XML positions vs swimlane assignment:');
  const stepRe = /<(invokeStep|decisionStep|endStep|gatewayStep|errorEventStep|terminateStep|receiveStep)\b[^>]*?\buid="([^"]+)"[^>]*?\bx="([^"]+)"[^>]*?\by="([^"]+)"/g;
  let mm: RegExpExecArray | null;
  let count = 0;
  while ((mm = stepRe.exec(xml)) !== null && count < 10) {
    const [, , uid, x, y] = mm;
    const sw = m.stepToLane.get(uid);
    const p = m.stepToPool.get(uid);
    console.log(`  ${uid} x=${x} y=${y}  →  swimlane=${sw ?? '-'}  pool=${p ?? '-'}`);
    count++;
  }
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
