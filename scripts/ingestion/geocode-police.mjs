import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { SOURCE_CATALOG } from './catalog.mjs';
import { decodeBuffer, parseCsv } from './lib/csv-utils.mjs';
import { loadProjectEnv } from './lib/env-utils.mjs';
import { ensureDir, listDirectory, writeJson } from './lib/fs-utils.mjs';

const POLICE_SOURCE_IDS = ['police-station', 'police-patrol-box', 'police-center'];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required.`);
  }

  return value;
}

async function issueSgisAccessToken() {
  const consumerKey = requireEnv('SGIS_CONSUMER_KEY');
  const consumerSecret = requireEnv('SGIS_CONSUMER_SECRET');

  const authUrl = new URL('https://sgisapi.kostat.go.kr/OpenAPI3/auth/authentication.json');
  authUrl.searchParams.set('consumer_key', consumerKey);
  authUrl.searchParams.set('consumer_secret', consumerSecret);

  const response = await fetch(authUrl, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Failed to issue SGIS token: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (payload.errCd !== 0) {
    throw new Error(`SGIS token error ${payload.errCd}: ${payload.errMsg}`);
  }

  return payload.result.accessToken;
}

async function geocodeAddress(accessToken, address) {
  const url = new URL('https://sgisapi.kostat.go.kr/OpenAPI3/addr/geocodewgs84.json');
  url.searchParams.set('accessToken', accessToken);
  url.searchParams.set('address', address);
  url.searchParams.set('resultcount', '1');

  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Failed to geocode "${address}": ${response.status}`);
  }

  const payload = await response.json();
  if (payload.errCd !== 0) {
    return null;
  }

  const result = payload.result?.resultdata?.[0];
  if (!result) {
    return null;
  }

  return {
    longitude: Number(result.x),
    latitude: Number(result.y),
    fullAddress: result.full_addr,
    sggCd: result.sgg_cd,
    sidoCd: result.sido_cd,
  };
}

export async function findLatestRunDirWithCsv(sourceId, outputRoot) {
  const sourceRoot = path.join(outputRoot, sourceId);
  const entries = await listDirectory(sourceRoot);
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const dirName of dirs) {
    const runDir = path.join(sourceRoot, dirName);
    const runEntries = await listDirectory(runDir);
    const csvFileName = pickFirstCsvFile(runEntries);
    if (csvFileName) {
      return {
        runDir,
        csvFileName,
      };
    }
  }

  return null;
}

function pickFirstCsvFile(entries) {
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.csv'))
    .map((entry) => entry.name)
    .sort()
    .at(0);
}

function normalizeRecordKey(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\s+/g, '')
    .trim();
}

function extractAddressField(record) {
  const aliases = ['경찰서주소', '주소', '소재지주소', '경찰관서주소', '도로명주소', '지번주소', 'policeAddress'];
  const normalizedRecord = new Map(
    Object.entries(record).map(([key, value]) => [normalizeRecordKey(key), value]),
  );

  for (const alias of aliases) {
    const value = normalizedRecord.get(normalizeRecordKey(alias));
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

async function loadCsvRecords(csvPath) {
  const buffer = await fs.readFile(csvPath);
  return parseCsv(decodeBuffer(buffer));
}

async function main() {
  await loadProjectEnv(path.resolve('.'));

  const outputRoot = path.resolve('data', 'raw');
  const geocodedRoot = path.resolve('data', 'derived', 'police-geocoded');
  await ensureDir(geocodedRoot);

  const accessToken = await issueSgisAccessToken();
  const manifests = [];

  for (const sourceId of POLICE_SOURCE_IDS) {
    const latestRun = await findLatestRunDirWithCsv(sourceId, outputRoot);
    if (!latestRun) {
      console.log(`Skipping ${sourceId}: no raw run with CSV found.`);
      continue;
    }

    const csvPath = path.join(latestRun.runDir, latestRun.csvFileName);
    const records = await loadCsvRecords(csvPath);
    const geocodedRecords = [];

    for (const record of records) {
      const address = extractAddressField(record);
      if (!address) {
        geocodedRecords.push({ ...record, geocodeStatus: 'missing-address' });
        continue;
      }

      const geocode = await geocodeAddress(accessToken, address);
      if (!geocode) {
        geocodedRecords.push({ ...record, geocodeStatus: 'not-found' });
        continue;
      }

      geocodedRecords.push({
        ...record,
        geocodeStatus: 'ok',
        longitude: geocode.longitude,
        latitude: geocode.latitude,
        geocodedAddress: geocode.fullAddress,
      });
    }

    const targetPath = path.join(geocodedRoot, `${sourceId}.json`);
    await writeJson(targetPath, geocodedRecords);
    manifests.push({ sourceId, recordCount: geocodedRecords.length, targetPath });
    console.log(`Geocoded ${sourceId}: ${geocodedRecords.length} record(s) -> ${targetPath}`);
  }

  await writeJson(path.join(geocodedRoot, 'manifest.json'), {
    createdAt: new Date().toISOString(),
    sources: manifests,
    sourceCatalog: SOURCE_CATALOG.filter((source) => POLICE_SOURCE_IDS.includes(source.id)).map(
      (source) => ({
        id: source.id,
        title: source.title,
        legal: source.legal,
      }),
    ),
  });
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
