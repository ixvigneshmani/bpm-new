import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import sql from 'mssql';
loadEnv({ path: resolve(__dirname, '..', '.env.webmethods') });
async function main() {
  const pool = await sql.connect({
    server: process.env.WEBMETHODS_DB_HOST!, port: Number(process.env.WEBMETHODS_DB_PORT) || 1433,
    database: process.env.WEBMETHODS_DB_NAME!, user: process.env.WEBMETHODS_DB_USER!,
    password: process.env.WEBMETHODS_DB_PASSWORD!,
    options: { encrypt: true, trustServerCertificate: true, readOnlyIntent: true },
  });
  const r = await pool.request()
    .input('key', sql.NVarChar(255), 'DOEPetroleumProc/PermitProcess')
    .input('ver', sql.NVarChar(64), '4').input('dep', sql.Int, 13)
    .query(`SELECT PROCESSFILE FROM WMPROCESSDEFINITION WHERE PROCESSKEY=@key AND MODELVERSION=@ver AND DEPLOYMENTVERSION=@dep`);
  const xml = (r.recordset[0].PROCESSFILE as Buffer).toString('utf8');
  console.log('Pool & swimlane openings (full attrs):');
  for (const m of xml.matchAll(/<(pool|swimlane)\b[^>]*>/g)) {
    console.log('---', m[1], '---');
    console.log(m[0].slice(0, 400));
  }
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
