import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';

import { decodeBuffer } from '../scripts/ingestion/lib/csv-utils.mjs';
import { collectSource, parseSeoulOpenApiSpec } from '../scripts/ingestion/lib/collectors.mjs';
import { loadProjectEnv } from '../scripts/ingestion/lib/env-utils.mjs';
import { findLatestRunDirWithCsv } from '../scripts/ingestion/geocode-police.mjs';
import { extractLinksFromHtml, pickLinksForSelector } from '../scripts/ingestion/lib/html-utils.mjs';
import { downloadToFile } from '../scripts/ingestion/lib/http-utils.mjs';
import { parseCsv } from '../scripts/ingestion/lib/csv-utils.mjs';

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

async function runAsync(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function createInvalidContentLengthError() {
  const error = new TypeError('fetch failed');
  error.cause = Object.assign(new Error('Parse Error: Duplicate Content-Length'), {
    code: 'HPE_UNEXPECTED_CONTENT_LENGTH',
  });
  return error;
}

async function createRawHttpServer(responseBody, extraHeaders = []) {
  const bodyBuffer = Buffer.isBuffer(responseBody) ? responseBody : Buffer.from(responseBody);
  const server = net.createServer((socket) => {
    socket.once('data', () => {
      const headers = [
        'HTTP/1.1 200 OK',
        `Content-Length: ${bodyBuffer.byteLength}`,
        `Content-Length: ${bodyBuffer.byteLength}`,
        'Content-Type: application/octet-stream',
        'Connection: close',
        ...extraHeaders,
        '',
        '',
      ].join('\r\n');

      socket.write(headers);
      socket.write(bodyBuffer);
      socket.end();
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

const tempDirs = new Set();
const tempRoot = path.join(process.cwd(), '.tmp-tests');

function uniqueTempDir(prefix) {
  const safePrefix = prefix.replace(/[^a-z0-9-]+/gi, '-');
  mkdirSync(tempRoot, { recursive: true });
  const dir = mkdtempSync(path.join(tempRoot, `${safePrefix}-`));
  tempDirs.add(dir);
  return dir;
}

async function cleanupTempDirs() {
  const removeWithRetry = async (targetPath) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await fs.rm(targetPath, { recursive: true, force: true });
        return;
      } catch (error) {
        if (error?.code !== 'EPERM' || attempt === 9) {
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  };

  for (const dir of tempDirs) {
    await removeWithRetry(dir);
  }

  await removeWithRetry(tempRoot);
}

process.once('exit', () => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore best-effort cleanup failures during process shutdown on Windows.
    }
  }

  try {
    rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // Ignore best-effort cleanup failures during process shutdown on Windows.
  }
});

run('extractLinksFromHtml keeps javascript links with nested quotes', () => {
  const html = `
    <a href="javascript:downloadFile('49');" title="file">서울시버스정류소위치정보(20260108).xlsx</a>
    <a href="/download/test.csv">test.csv</a>
  `;

  const links = extractLinksFromHtml(html, 'https://data.seoul.go.kr/dataList/OA-15067/A/1/datasetView.do');
  assert.equal(links[0].url, "javascript:downloadFile('49');");
  assert.equal(links[1].url, 'https://data.seoul.go.kr/download/test.csv');
});

run('pickLinksForSelector chooses the latest dated file', () => {
  const links = [
    { url: '/a', text: '서울시버스정류소위치정보(20251209).xlsx' },
    { url: '/b', text: '서울시버스정류소위치정보(20260108).xlsx' },
  ];

  const picked = pickLinksForSelector(links, {
    include: ['버스정류소', '.xlsx'],
    pick: 'latest',
  });

  assert.equal(picked.length, 1);
  assert.equal(picked[0].url, '/b');
});

run('parseCsv handles commas and escaped quotes', () => {
  const rows = parseCsv('name,address\n"alpha","Seoul, Korea"\n"beta","He said ""hi"""');

  assert.deepEqual(rows, [
    { name: 'alpha', address: 'Seoul, Korea' },
    { name: 'beta', address: 'He said "hi"' },
  ]);
});

await runAsync('decodeBuffer decodes CP949 police CSV headers without mojibake', async () => {
  const cp949Csv = Buffer.from(
    'bfacb9f82cbdc3b5b5c3bb2cb0e6c2fbbcad2cb0fcbcadb8ed2cb1b8bad02cc1d6bcd20d0a312cbcadbfefc3bb2cbcadbfefc1dfbace2cc0bbc1f62cc1f6b1b8b4eb2cbcadbfefc6afbab0bdc320c1dfb1b820c5f0b0e8b7ce3439b1e62031330d0a',
    'hex',
  );

  const decoded = decodeBuffer(cp949Csv);
  const rows = parseCsv(decoded);

  assert.match(decoded, /^연번,시도청,경찰서,관서명,구분,주소/);
  assert.equal(rows[0].주소, '서울특별시 중구 퇴계로49길 13');
  assert.equal(rows[0].관서명, '을지');
});

await runAsync('downloadToFile falls back to legacy HTTP client on duplicate Content-Length', async () => {
  const originalFetch = global.fetch;
  const server = await createRawHttpServer('legacy fallback payload', [
    'Content-Disposition: attachment; filename="localdata.xml"',
  ]);
  const address = server.address();
  const outputDir = uniqueTempDir('.tmp-http-utils');

  global.fetch = async () => {
    throw createInvalidContentLengthError();
  };

  try {
    const result = await downloadToFile({
      url: `http://127.0.0.1:${address.port}/data/dataDownload.do`,
      outputDir,
      suggestedName: 'localdata.xml',
      method: 'POST',
      formData: {
        fileType: 'xml',
        opnSvcIdEx: '07_24_05_P',
      },
    });

    const saved = await fs.readFile(result.filePath, 'utf8');
    assert.equal(saved, 'legacy fallback payload');
    assert.equal(path.basename(result.filePath), 'localdata.xml');
    assert.equal(result.headers['content-disposition'], 'attachment; filename="localdata.xml"');
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve, reject) =>
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      }),
    );
  }
});

await runAsync('collectSource falls back when open-api URL is not configured', async () => {
  const outputRoot = uniqueTempDir('.tmp-collectors');
  const manifest = await collectSource(
    {
      id: 'demo-open-api',
      title: 'Demo Open API',
      provider: 'Test',
      strategy: {
        type: 'open-api',
        urlEnvPath: 'SAFE_ROUTE_DEMO_OPEN_API_URL',
        fallback: {
          type: 'manual',
          envPath: 'SAFE_ROUTE_DEMO_MANUAL_PATH',
          expectedPatterns: ['*.json'],
        },
      },
      legal: {
        summary: 'test',
        license: 'test',
        notes: [],
        sources: [],
      },
    },
    {
      outputRoot,
      dryRun: false,
    },
  );

  assert.equal(manifest.requestedStrategy, 'open-api');
  assert.equal(manifest.strategyUsed, 'manual');
  assert.equal(manifest.strategy, 'manual');
  assert.match(manifest.warnings[0], /Open API URL is not configured/i);
  assert.match(manifest.warnings[1], /SAFE_ROUTE_DEMO_MANUAL_PATH/i);
});

await runAsync('collectSource manual strategy does not copy files during dry-run', async () => {
  const outputRoot = uniqueTempDir('.tmp-manual-dry-run');
  const manualSourceDir = uniqueTempDir('.tmp-manual-source');
  const manualSourcePath = path.join(manualSourceDir, 'population.zip');
  const originalManualPath = process.env.SAFE_ROUTE_DEMO_MANUAL_DRY_RUN_PATH;

  await fs.writeFile(manualSourcePath, 'demo archive');
  process.env.SAFE_ROUTE_DEMO_MANUAL_DRY_RUN_PATH = manualSourcePath;

  try {
    const manifest = await collectSource(
      {
        id: 'demo-manual',
        title: 'Demo Manual Source',
        provider: 'Test',
        strategy: {
          type: 'manual',
          envPath: 'SAFE_ROUTE_DEMO_MANUAL_DRY_RUN_PATH',
          expectedPatterns: ['*.zip'],
        },
        legal: {
          summary: 'test',
          license: 'test',
          notes: [],
          sources: [],
        },
      },
      {
        outputRoot,
        dryRun: true,
      },
    );

    assert.equal(manifest.dryRun, true);
    assert.equal(manifest.manualSourcePath, manualSourcePath);
    assert.equal(await fs.readFile(manifest.manifestPath, 'utf8').then(Boolean), true);
    await assert.rejects(fs.access(manifest.copiedTo));
  } finally {
    if (typeof originalManualPath === 'string') {
      process.env.SAFE_ROUTE_DEMO_MANUAL_DRY_RUN_PATH = originalManualPath;
    } else {
      delete process.env.SAFE_ROUTE_DEMO_MANUAL_DRY_RUN_PATH;
    }
  }
});

await runAsync('loadProjectEnv reads .env.local after .env without clobbering existing env', async () => {
  const projectRoot = uniqueTempDir('.tmp-env-loader');
  const originalSeoulApiKey = process.env.SEOUL_OPEN_API_KEY;
  const originalSgisKey = process.env.SGIS_CONSUMER_KEY;
  const originalDemoQuoted = process.env.DEMO_QUOTED_VALUE;

  await fs.writeFile(
    path.join(projectRoot, '.env'),
    'SEOUL_OPEN_API_KEY=from-dot-env\nSGIS_CONSUMER_KEY=should-not-win\n',
  );
  await fs.writeFile(
    path.join(projectRoot, '.env.local'),
    'SEOUL_OPEN_API_KEY=from-dot-env-local\nDEMO_QUOTED_VALUE=\"quoted value\"\n',
  );

  delete process.env.SEOUL_OPEN_API_KEY;
  process.env.SGIS_CONSUMER_KEY = 'preexisting-sgis-key';
  delete process.env.DEMO_QUOTED_VALUE;

  try {
    await loadProjectEnv(projectRoot);

    assert.equal(process.env.SEOUL_OPEN_API_KEY, 'from-dot-env-local');
    assert.equal(process.env.SGIS_CONSUMER_KEY, 'preexisting-sgis-key');
    assert.equal(process.env.DEMO_QUOTED_VALUE, 'quoted value');
  } finally {
    if (typeof originalSeoulApiKey === 'string') {
      process.env.SEOUL_OPEN_API_KEY = originalSeoulApiKey;
    } else {
      delete process.env.SEOUL_OPEN_API_KEY;
    }

    if (typeof originalSgisKey === 'string') {
      process.env.SGIS_CONSUMER_KEY = originalSgisKey;
    } else {
      delete process.env.SGIS_CONSUMER_KEY;
    }

    if (typeof originalDemoQuoted === 'string') {
      process.env.DEMO_QUOTED_VALUE = originalDemoQuoted;
    } else {
      delete process.env.DEMO_QUOTED_VALUE;
    }
  }
});

await runAsync('findLatestRunDirWithCsv skips dry-run runs without CSV output', async () => {
  const outputRoot = uniqueTempDir('.tmp-police-runs');
  const sourceRoot = path.join(outputRoot, 'police-station');
  const olderRunDir = path.join(sourceRoot, '2026-01-01T00-00-00Z');
  const newerDryRunDir = path.join(sourceRoot, '2026-01-02T00-00-00Z');

  await fs.mkdir(olderRunDir, { recursive: true });
  await fs.mkdir(newerDryRunDir, { recursive: true });
  await fs.writeFile(path.join(olderRunDir, 'stations.csv'), 'name,address\nA,Seoul');
  await fs.writeFile(path.join(newerDryRunDir, 'manifest.json'), '{}');

  const latestRun = await findLatestRunDirWithCsv('police-station', outputRoot);

  assert.equal(latestRun.runDir, olderRunDir);
  assert.equal(latestRun.csvFileName, 'stations.csv');
});

run('parseSeoulOpenApiSpec extracts service name and sample URL', () => {
  const spec = parseSeoulOpenApiSpec(`
    <script>
      var svcNm = 'LOCALDATA_072405_GN';
    </script>
    <a href="http://openapi.seoul.go.kr:8088/sample/xml/LOCALDATA_072405_GN/1/5/"></a>
  `, 'OA-18699');

  assert.equal(spec.serviceName, 'LOCALDATA_072405_GN');
  assert.equal(
    spec.sampleUrl,
    'http://openapi.seoul.go.kr:8088/sample/xml/LOCALDATA_072405_GN/1/5/',
  );
});

await runAsync('collectSource collects 서울 열린데이터광장 Open API series', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.SEOUL_OPEN_API_KEY;
  const outputRoot = uniqueTempDir('.tmp-seoul-open-api');

  process.env.SEOUL_OPEN_API_KEY = 'demo-key';

  global.fetch = async (url) => {
    const normalizedUrl = String(url);

    if (normalizedUrl === 'https://data.seoul.go.kr/dataList/openApiView.do?infId=OA-DEMO&srvType=A') {
      return new Response(`
        <script>var svcNm = 'LOCALDATA_DEMO';</script>
        <a href="http://openapi.seoul.go.kr:8088/sample/xml/LOCALDATA_DEMO/1/5/"></a>
      `, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    if (normalizedUrl === 'http://openapi.seoul.go.kr:8088/demo-key/json/LOCALDATA_DEMO/1/1000/') {
      return new Response(JSON.stringify({
        LOCALDATA_DEMO: {
          list_total_count: 2,
          RESULT: { CODE: 'INFO-000', MESSAGE: 'OK' },
          row: [{ id: 1 }, { id: 2 }],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch URL: ${normalizedUrl}`);
  };

  try {
    const manifest = await collectSource(
      {
        id: 'demo-seoul-open-api',
        title: 'Demo Seoul Open API',
        provider: 'Test',
        strategy: {
          type: 'seoul-open-api-series',
          keyEnvPath: 'SEOUL_OPEN_API_KEY',
          infIds: ['OA-DEMO'],
        },
        legal: {
          summary: 'test',
          license: 'test',
          notes: [],
          sources: [],
        },
      },
      {
        outputRoot,
        dryRun: false,
      },
    );

    assert.equal(manifest.requests.length, 1);
    assert.equal(manifest.requests[0].serviceName, 'LOCALDATA_DEMO');
    assert.equal(manifest.requests[0].rowCount, 2);

    const payload = JSON.parse(await fs.readFile(manifest.requests[0].filePath, 'utf8'));
    assert.equal(payload.serviceName, 'LOCALDATA_DEMO');
    assert.deepEqual(payload.rows, [{ id: 1 }, { id: 2 }]);
  } finally {
    global.fetch = originalFetch;

    if (typeof originalKey === 'string') {
      process.env.SEOUL_OPEN_API_KEY = originalKey;
    } else {
      delete process.env.SEOUL_OPEN_API_KEY;
    }
  }
});

await cleanupTempDirs();
