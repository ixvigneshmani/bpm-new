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
  const req = pool.request();
  req.input('key', sql.NVarChar(255), 'GasServicesProc/AMCProcess');
  req.input('ver', sql.NVarChar(64), '1');
  req.input('dep', sql.Int, 1);
  const r = await req.query(`SELECT PROCESSFILE FROM WMPROCESSDEFINITION WHERE PROCESSKEY=@key AND MODELVERSION=@ver AND DEPLOYMENTVERSION=@dep`);
  const xml = (r.recordset[0].PROCESSFILE as Buffer).toString('utf8');
  console.log('Total length:', xml.length);
  console.log('lane tag count:', (xml.match(/<lane\b/g) ?? []).length);
  console.log('swimlane tag count:', (xml.match(/<swimlane\b/g) ?? []).length);
  console.log('pool tag count:', (xml.match(/<pool\b/g) ?? []).length);
  console.log('\nFirst 3 <swimlane ...> openings:');
  const swims = [...xml.matchAll(/<swimlane\b[^>]*>/g)].slice(0, 5);
  for (const s of swims) console.log(s[0]);
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
