/**
 * Quick probe: fetch the BPD XML for one specific model and dump
 * its pool / lane structure so we can see what containers exist.
 * READ-ONLY.
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import sql from 'mssql';

loadEnv({ path: resolve(__dirname, '..', '.env.webmethods') });

const KEY = process.argv[2] ?? 'SNIProc/SNIProcess';
const VER = process.argv[3] ?? '1';
const DEP = Number(process.argv[4] ?? '2');

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
  const res = await req.query(`
    SELECT PROCESSLABEL, PROCESSFILE
    FROM WMPROCESSDEFINITION
    WHERE PROCESSKEY = @key AND MODELVERSION = @ver AND DEPLOYMENTVERSION = @dep;
  `);

  if (res.recordset.length === 0) {
    console.log('NOT FOUND');
    return;
  }
  const xml = Buffer.isBuffer(res.recordset[0].PROCESSFILE)
    ? (res.recordset[0].PROCESSFILE as Buffer).toString('utf8')
    : String(res.recordset[0].PROCESSFILE);

  console.log(`Label: ${res.recordset[0].PROCESSLABEL}`);
  console.log(`XML length: ${xml.length}`);

  // Print just the pool + lane skeleton with attributes, not the full XML.
  console.log('\n--- POOL / LANE skeleton (attributes only) ---');
  const tagRe = /<(pool|lane|invokeStep|decisionStep|endStep)([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  let depth = 0;
  while ((m = tagRe.exec(xml)) !== null) {
    const tag = m[1];
    const attrs = m[2].trim();
    // Pick out a few interesting attributes
    const uid = /uid="([^"]+)"/.exec(attrs)?.[1] ?? '?';
    const x = /\bx="([^"]+)"/.exec(attrs)?.[1] ?? '';
    const y = /\by="([^"]+)"/.exec(attrs)?.[1] ?? '';
    const w = /\bwidth="([^"]+)"/.exec(attrs)?.[1] ?? '';
    const h = /\bheight="([^"]+)"/.exec(attrs)?.[1] ?? '';
    const label = /\blabel="([^"]+)"/.exec(attrs)?.[1] ?? '';
    const name = /\bname="([^"]+)"/.exec(attrs)?.[1] ?? '';
    if (tag === 'pool') depth = 0;
    if (tag === 'lane') depth = 1;
    const prefix = ' '.repeat(depth * 2);
    console.log(
      `${prefix}<${tag} uid=${uid} x=${x} y=${y} w=${w} h=${h} label="${label}" name="${name}">`,
    );
    if (m[0].endsWith('/>')) continue;
  }

  // Also count occurrences
  const counts: Record<string, number> = {};
  for (const t of ['pool', 'lane', 'invokeStep', 'decisionStep', 'endStep', 'transition']) {
    counts[t] = (xml.match(new RegExp(`<${t}\\b`, 'g')) ?? []).length;
  }
  console.log('\n--- Counts ---');
  console.table(counts);

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
