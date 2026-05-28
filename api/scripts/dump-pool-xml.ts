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
  req.input('key', sql.NVarChar(255), 'DOEPetroleumProc/PermitProcess');
  req.input('ver', sql.NVarChar(64), '4');
  req.input('dep', sql.Int, 13);
  const res = await req.query(`
    SELECT PROCESSFILE
    FROM WMPROCESSDEFINITION
    WHERE PROCESSKEY = @key AND MODELVERSION = @ver AND DEPLOYMENTVERSION = @dep;
  `);

  const xml = (res.recordset[0].PROCESSFILE as Buffer).toString('utf8');

  // Print just the START of each <pool ...> (the opening tag through end of attrs)
  // AND print the IMMEDIATE children element tag names of each pool
  console.log('=== Distinct element tag names in this XML ===');
  const tags = [...xml.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b/g)].map((m) => m[1]);
  const tagSet = [...new Set(tags)].sort();
  console.log(tagSet.join(', '));

  console.log('\n=== Pool nesting analysis ===');
  // Find all <pool> opening tags with their position and depth-track <pool>...</pool>
  const poolOpenRe = /<pool\b[^>]*>/g;
  const poolCloseRe = /<\/pool>/g;
  const opens = [...xml.matchAll(poolOpenRe)];
  const closes = [...xml.matchAll(poolCloseRe)];
  console.log(`opens=${opens.length} closes=${closes.length}`);
  for (const o of opens) {
    console.log(`\n--- POOL OPEN @${o.index} ---`);
    console.log(o[0].slice(0, 250));
  }

  // Also: see how many invokeStep are direct vs nested. We'll mark depth.
  // Walk char by char tracking open/close of pool, lane, then count invokeStep occurrences at each (poolUid).
  console.log('\n=== Invoke-step counts per pool (sequential scan) ===');
  const tagRe = /<\/?(pool|lane|invokeStep|decisionStep|endStep|transition)\b[^>]*\/?>/g;
  const stack: string[] = [];
  const stepsByPool: Record<string, number> = {};
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const tag = m[0];
    const name = m[1];
    const isClose = tag.startsWith('</');
    const isSelfClose = tag.endsWith('/>');
    if (isClose) {
      // pop matching
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].startsWith(`${name}:`)) {
          stack.splice(i, 1);
          break;
        }
      }
      continue;
    }
    // open tag
    if (name === 'pool') {
      const uidMatch = /\buid="([^"]+)"/.exec(tag);
      const uid = uidMatch ? uidMatch[1] : '?';
      const top = stack[stack.length - 1];
      if (!top || !top.startsWith('pool:')) {
        // Only push as a real pool when at top level (not nested inside another pool)
        stack.push(`pool:${uid}`);
        stepsByPool[uid] = 0;
      }
    } else if (name === 'invokeStep' || name === 'decisionStep' || name === 'endStep') {
      const top = stack[stack.length - 1];
      if (top && top.startsWith('pool:')) {
        const uid = top.slice(5);
        stepsByPool[uid] = (stepsByPool[uid] ?? 0) + 1;
      }
    }
    if (!isSelfClose && name !== 'invokeStep' && name !== 'decisionStep' && name !== 'endStep' && name !== 'transition') {
      // (already pushed pool above)
    }
  }
  console.table(stepsByPool);

  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
