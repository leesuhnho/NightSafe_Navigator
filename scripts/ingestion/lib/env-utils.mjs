import fs from 'node:fs/promises';
import path from 'node:path';

function parseEnvValue(rawValue) {
  const trimmed = rawValue.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const quote = trimmed[0];
    const inner = trimmed.slice(1, -1);

    if (quote === '"') {
      return inner
        .replaceAll('\\n', '\n')
        .replaceAll('\\r', '\r')
        .replaceAll('\\"', '"')
        .replaceAll('\\\\', '\\');
    }

    return inner;
  }

  return trimmed;
}

function parseEnvAssignments(fileContents) {
  const assignments = [];

  for (const line of fileContents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }

    assignments.push({
      key: match[1],
      value: parseEnvValue(match[2]),
    });
  }

  return assignments;
}

export async function loadProjectEnv(projectRoot = process.cwd()) {
  const envFiles = ['.env', '.env.local'];
  const protectedKeys = new Set(Object.keys(process.env));

  for (const envFile of envFiles) {
    const envPath = path.join(projectRoot, envFile);
    let fileContents;

    try {
      fileContents = await fs.readFile(envPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue;
      }

      throw error;
    }

    for (const assignment of parseEnvAssignments(fileContents)) {
      if (protectedKeys.has(assignment.key)) {
        continue;
      }

      process.env[assignment.key] = assignment.value;
    }
  }
}
