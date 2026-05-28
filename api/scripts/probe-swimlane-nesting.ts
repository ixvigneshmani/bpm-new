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
  const r = await pool.request()
    .input('key', sql.NVarChar(255), 'GasServicesProc/AMCProcess')
    .input('ver', sql.NVarChar(64), '1')
    .input('dep', sql.Int, 1)
    .query(`SELECT PROCESSFILE FROM WMPROCESSDEFINITION WHERE PROCESSKEY=@key AND MODELVERSION=@ver AND DEPLOYMENTVERSION=@dep`);
  const xml = (r.recordset[0].PROCESSFILE as Buffer).toString('utf8');

  // Stack-walk to see what tag nests what
  const tagRe = /<\/?(pool|swimlane|invokeStep|decisionStep|gatewayStep|endStep|errorEventStep|terminateStep|receiveStep|transition)\b[^>]*\/?>/g;
  const stack: string[] = [];
  const stepsByContainer: Record<string, number> = {};
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const tag = m[0]; const name = m[1];
    const isClose = tag.startsWith('</');
    const isSelfClose = tag.endsWith('/>');
    if (isClose) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].startsWith(`${name}:`)) { stack.splice(i, 1); break; }
      }
      continue;
    }
    if (name === 'pool' || name === 'swimlane') {
      const uid = /\buid="([^"]+)"/.exec(tag)?.[1] ?? '?';
      const label = /\blabel="([^"]+)"/.exec(tag)?.[1] ?? '';
      const key = `${name}:${uid}${label ? `(${label})` : ''}`;
      // Push if not self-closing
      if (!isSelfClose) stack.push(key);
      stepsByContainer[key] = stepsByContainer[key] ?? 0;
    } else if (['invokeStep','decisionStep','gatewayStep','endStep','errorEventStep','terminateStep','receiveStep'].includes(name)) {
      // Assign step to deepest container on stack
      const top = stack[stack.length - 1];
      if (top) stepsByContainer[top] = (stepsByContainer[top] ?? 0) + 1;
    }
  }
  console.log('Steps per container (deepest container wins):');
  console.table(stepsByContainer);
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
