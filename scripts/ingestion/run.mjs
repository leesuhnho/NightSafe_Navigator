import path from 'node:path';
import process from 'node:process';

import { SOURCE_CATALOG, getSourceById, resolveSourceIds } from './catalog.mjs';
import { collectSource } from './lib/collectors.mjs';
import { loadProjectEnv } from './lib/env-utils.mjs';

function parseArgs(argv) {
  const positional = [];
  const flags = {
    dryRun: false,
    outputRoot: path.resolve('data', 'raw'),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--dry-run') {
      flags.dryRun = true;
      continue;
    }

    if (token === '--output-root') {
      flags.outputRoot = path.resolve(argv[index + 1]);
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
  node scripts/ingestion/run.mjs collect all [--dry-run] [--output-root data/raw]
  node scripts/ingestion/run.mjs collect walk-network safe-route bus-stop
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
  console.error(error.message);
  process.exitCode = 1;
});
