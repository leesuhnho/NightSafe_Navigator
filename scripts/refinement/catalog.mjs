import fs from 'node:fs/promises';
import path from 'node:path';

import { decodeBuffer, parseCsv } from '../ingestion/lib/csv-utils.mjs';
import { pickDownloadedFile } from './lib/raw-run-utils.mjs';
import { readFirstWorksheetObjects } from './lib/xlsx-utils.mjs';

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNullableNumber(value) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractRecordValue(record, aliases) {
  const normalizedRecord = new Map(
    Object.entries(record).map(([key, value]) => [normalizeWhitespace(key), value]),
  );

  for (const alias of aliases) {
    const value = normalizedRecord.get(normalizeWhitespace(alias));
    if (value !== undefined) {
      return value;
    }
  }

  return '';
}

function summarizeCounts(values) {
  return values.reduce((accumulator, value) => {
    const key = normalizeWhitespace(value) || '(blank)';
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});
}

function extractStandardDate(value) {
  const match = String(value ?? '').match(/(20\d{2})(\d{2})(\d{2})/);
  if (!match) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

async function refineBusStop({ manifest }) {
  const dataFilePath = pickDownloadedFile(
    manifest,
    (download) => download.selector === 'bus-stop-data' || download.filePath.endsWith('.xlsx'),
  );

  if (!dataFilePath) {
    throw new Error('No usable bus-stop XLSX file was found in the raw manifest.');
  }

  const rows = await readFirstWorksheetObjects(dataFilePath, { sheetName: 'Data' });
  const standardDate =
    extractStandardDate(path.basename(dataFilePath)) ??
    extractStandardDate(
      (manifest.downloads ?? []).find((download) => download.filePath === dataFilePath)?.text,
    );

  const records = rows.map((row) => {
    const nodeId = normalizeWhitespace(extractRecordValue(row, ['NODE_ID', '노드 ID']));
    const arsId = normalizeWhitespace(extractRecordValue(row, ['ARS_ID', 'ARS-ID', '정류소번호']));
    const stopName = normalizeWhitespace(extractRecordValue(row, ['정류소명', 'STTN_NM']));
    const longitude = parseNullableNumber(extractRecordValue(row, ['X좌표', 'CRDNT_X']));
    const latitude = parseNullableNumber(extractRecordValue(row, ['Y좌표', 'CRDNT_Y']));
    const stopType = normalizeWhitespace(extractRecordValue(row, ['정류소타입', '정류소 유형', 'STTN_TY']));

    return {
      sourceId: 'bus-stop',
      sourceRunId: manifest.runId,
      standardDate,
      recordId: nodeId || arsId,
      nodeId,
      arsId,
      stopName,
      longitude,
      latitude,
      stopType,
    };
  });

  return {
    sourceFiles: [dataFilePath],
    records,
    warnings: [],
    stats: {
      standardDate,
      missingNodeId: records.filter((record) => !record.nodeId).length,
      missingCoordinates: records.filter(
        (record) => record.longitude === null || record.latitude === null,
      ).length,
      stopTypes: summarizeCounts(records.map((record) => record.stopType)),
    },
  };
}

async function refinePolicePatrolBox({ manifest }) {
  const csvPath = pickDownloadedFile(
    manifest,
    (download) => download.selector === 'police-patrol-box-csv' || download.filePath.endsWith('.csv'),
  );

  if (!csvPath) {
    throw new Error('No usable police patrol-box CSV file was found in the raw manifest.');
  }

  const buffer = await fs.readFile(csvPath);
  const sourceRows = parseCsv(decodeBuffer(buffer));
  const seoulRows = sourceRows.filter((row) => {
    const policeOffice = normalizeWhitespace(extractRecordValue(row, ['시도청']));
    const address = normalizeWhitespace(extractRecordValue(row, ['주소', '소재지주소']));
    return policeOffice.includes('서울') || address.startsWith('서울');
  });

  const records = seoulRows.map((row) => {
    const sequence = normalizeWhitespace(extractRecordValue(row, ['연번']));
    const policeOffice = normalizeWhitespace(extractRecordValue(row, ['시도청']));
    const policeStation = normalizeWhitespace(extractRecordValue(row, ['경찰서']));
    const facilityName = normalizeWhitespace(extractRecordValue(row, ['관서명']));
    const facilityType = normalizeWhitespace(extractRecordValue(row, ['구분']));
    const address = normalizeWhitespace(extractRecordValue(row, ['주소', '소재지주소']));
    const fullName = normalizeWhitespace(`${policeStation} ${facilityName}${facilityType}`);

    return {
      sourceId: 'police-patrol-box',
      sourceRunId: manifest.runId,
      recordId: sequence || fullName,
      sequence,
      policeOffice,
      policeStation,
      facilityName,
      facilityType,
      fullName,
      address,
    };
  });

  return {
    sourceFiles: [csvPath],
    records,
    warnings: [],
    stats: {
      rawRecordCount: sourceRows.length,
      seoulRecordCount: records.length,
      filteredOutCount: sourceRows.length - records.length,
      facilityTypes: summarizeCounts(records.map((record) => record.facilityType)),
    },
  };
}

export const REFINER_CATALOG = [
  {
    id: 'bus-stop',
    logicalDataset: 'BUS_STOP',
    title: '서울시 버스정류소 위치정보',
    isUsableRun: ({ manifest }) =>
      Boolean(
        pickDownloadedFile(
          manifest,
          (download) =>
            download.selector === 'bus-stop-data' ||
            download.filePath.toLowerCase().endsWith('.xlsx'),
        ),
      ),
    refine: refineBusStop,
  },
  {
    id: 'police-patrol-box',
    logicalDataset: 'POLICE_FACILITY',
    title: '경찰청_전국 지구대 파출소 주소 현황',
    isUsableRun: ({ manifest }) =>
      Boolean(
        pickDownloadedFile(
          manifest,
          (download) =>
            download.selector === 'police-patrol-box-csv' ||
            download.filePath.toLowerCase().endsWith('.csv'),
        ),
      ),
    refine: refinePolicePatrolBox,
  },
];

export function getRefinerById(sourceId) {
  return REFINER_CATALOG.find((refiner) => refiner.id === sourceId) ?? null;
}

export function resolveRefinerIds(sourceIds) {
  if (sourceIds.includes('all')) {
    return REFINER_CATALOG.map((refiner) => refiner.id);
  }

  return [...new Set(sourceIds)];
}
