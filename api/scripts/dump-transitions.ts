/** Dump a sample of <transition> elements with full inner content to
 *  see what per-edge data webMethods stored (bendpoints, labelLayout,
 *  conditions, etc.). READ-ONLY. */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import sql from 'mssql';

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
  const res = await req.query(`SELECT PROCESSFILE FROM WMPROCESSDEFINITION WHERE PROCESSKEY=@key AND MODELVERSION=@ver AND DEPLOYMENTVERSION=@dep`);
  const xml = (res.recordset[0].PROCESSFILE as Buffer).toString('utf8');

  // Count bendpoints overall and per transition
  const totalBp = (xml.match(/<bendpoint\b/g) ?? []).length;
  const totalTx = (xml.match(/<transition\b/g) ?? []).length;
  console.log(`Transitions: ${totalTx}`);
  console.log(`Bendpoints in XML: ${totalBp}`);

  // Pull the first 5 <transition>...</transition> blocks intact
  console.log('\n=== Sample transitions ===');
  const txRe = /<transition\b[^>]*>[\s\S]*?<\/transition>/g;
  const samples = [...xml.matchAll(txRe)].slice(0, 5);
  for (const m of samples) {
    console.log('---');
    console.log(m[0]);
  }

  // Also: how many transitions are self-closing (no waypoints)?
  const selfClose = (xml.match(/<transition\b[^>]*\/>/g) ?? []).length;
  console.log(`\nSelf-closing transitions (no bendpoints): ${selfClose}`);

  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
