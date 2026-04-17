import path from 'node:path';
import process from 'node:process';

import { SOURCE_CATALOG, getSourceById, resolveSourceIds } from './catalog.mjs';
import { collectSource } from './lib/collectors.mjs';
import { formatErrorChain } from './lib/debug-utils.mjs';
import { loadProjectEnv } from './lib/env-utils.mjs';

function parseArgs(argv) {
  const positional = [];
  const flags = {
    dryRun: false,
    debug: false,
    debugRoot: path.resolve('02_debug'),
    outputRoot: path.resolve('data', 'raw'),
    requestTimeoutMs: 30000,
    downloadStartTimeoutMs: 30000,
    downloadIdleTimeoutMs: 120000,
    downloadMaxDurationMs: null,
    networkRetryCount: 4,
    networkRetryBaseMs: 1000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--dry-run') {
      flags.dryRun = true;
      continue;
    }

    if (token === '--debug') {
      flags.debug = true;
      continue;
    }

    if (token === '--debug-root') {
      flags.debugRoot = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === '--output-root') {
      flags.outputRoot = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === '--request-timeout-ms') {
      const timeoutValue = Number(argv[index + 1]);
      if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) {
        throw new Error('--request-timeout-ms expects a positive number.');
      }

      flags.requestTimeoutMs = timeoutValue;
      index += 1;
      continue;
    }

    if (token === '--download-start-timeout-ms') {
      const timeoutValue = Number(argv[index + 1]);
      if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) {
        throw new Error('--download-start-timeout-ms expects a positive number.');
      }

      flags.downloadStartTimeoutMs = timeoutValue;
      index += 1;
      continue;
    }

    if (token === '--download-idle-timeout-ms') {
      const timeoutValue = Number(argv[index + 1]);
      if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) {
        throw new Error('--download-idle-timeout-ms expects a positive number.');
      }

      flags.downloadIdleTimeoutMs = timeoutValue;
      index += 1;
      continue;
    }

    if (token === '--download-max-duration-ms') {
      const rawValue = argv[index + 1];
      if (rawValue === '0' || /^off$/i.test(rawValue) || /^none$/i.test(rawValue)) {
        flags.downloadMaxDurationMs = null;
        index += 1;
        continue;
      }

      const timeoutValue = Number(rawValue);
      if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) {
        throw new Error('--download-max-duration-ms expects a positive number, 0, "off", or "none".');
      }

      flags.downloadMaxDurationMs = timeoutValue;
      index += 1;
      continue;
    }

    if (token === '--network-retry-count') {
      const retryCount = Number(argv[index + 1]);
      if (!Number.isInteger(retryCount) || retryCount < 0) {
        throw new Error('--network-retry-count expects a non-negative integer.');
      }

      flags.networkRetryCount = retryCount;
      index += 1;
      continue;
    }

    if (token === '--network-retry-base-ms') {
      const retryBaseMs = Number(argv[index + 1]);
      if (!Number.isFinite(retryBaseMs) || retryBaseMs <= 0) {
        throw new Error('--network-retry-base-ms expects a positive number.');
      }

      flags.networkRetryBaseMs = retryBaseMs;
      index += 1;
      continue;
    }

    positional.push(token);
  }

  return { positional, flags };
}

function printHelp() {
  console.log(`Usage:
  node scripts/ingestion/run.mjs list
  node scripts/ingestion/run.mjs collect all [--dry-run] [--debug] [--debug-root 02_debug] [--request-timeout-ms 30000] [--download-start-timeout-ms 30000] [--download-idle-timeout-ms 120000] [--download-max-duration-ms off] [--network-retry-count 4] [--network-retry-base-ms 1000] [--output-root data/raw]
  node scripts/ingestion/run.mjs collect walk-network safe-route bus-stop [--debug]
`);
}

function printList() {
  for (const source of SOURCE_CATALOG) {
    console.log(
      `${source.id} | ${source.strategy.type} | ${source.tables.join(', ')} | ${source.title}`,
    );
  }
}

async function runCollect(sourceIds, flags) {
  const resolvedSourceIds = resolveSourceIds(sourceIds);
  const unknown = resolvedSourceIds.filter((sourceId) => !getSourceById(sourceId));

  if (unknown.length > 0) {
    throw new Error(`Unknown source ids: ${unknown.join(', ')}`);
  }

  const manifests = [];

  for (const sourceId of resolvedSourceIds) {
    const source = getSourceById(sourceId);
    console.log(`Collecting ${source.id} -> ${source.title}`);
    const manifest = await collectSource(source, flags);
    manifests.push(manifest);
    console.log(`  saved run: ${manifest.runId}`);
    if (manifest.warnings?.length) {
      for (const warning of manifest.warnings) {
        console.log(`  warning: ${warning}`);
      }
    }
  }

  console.log(`Completed ${manifests.length} source(s). Output root: ${flags.outputRoot}`);
}

async function main() {
  await loadProjectEnv(path.resolve('.'));

  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = positional;

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  if (command === 'list') {
    printList();
    return;
  }

  if (command === 'collect') {
    if (rest.length === 0) {
      throw new Error('collect command requires at least one source id or "all".');
    }

    await runCollect(rest, flags);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(formatErrorChain(error, { includeStack: process.argv.includes('--debug') }));
  process.exitCode = 1;
});
