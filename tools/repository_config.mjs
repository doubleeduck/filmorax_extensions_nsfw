import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const id = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_.-]{0,127}$/u.test(value);
export async function readRepositoryConfig(root) {
  let config;
  try {
    config = JSON.parse(await readFile(join(root, 'repository.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (
    !config ||
    Array.isArray(config) ||
    config.schemaVersion !== 1 ||
    Object.keys(config).some(
      (key) =>
        ![
          'schemaVersion',
          'name',
          'channel',
          'publisherKeyId',
          'sourceIds',
          'hostFeatures',
        ].includes(key),
    ) ||
    !['standard', 'nsfw'].includes(config.channel) ||
    !id(config.publisherKeyId) ||
    typeof config.name !== 'string' ||
    config.name.length > 160 ||
    !Array.isArray(config.sourceIds) ||
    config.sourceIds.length > 64 ||
    !Array.isArray(config.hostFeatures) ||
    config.hostFeatures.length > 16 ||
    [...config.sourceIds, ...config.hostFeatures].some((value) => !id(value)) ||
    new Set(config.sourceIds).size !== config.sourceIds.length ||
    new Set(config.hostFeatures).size !== config.hostFeatures.length ||
    (config.channel === 'nsfw' && config.hostFeatures.length)
  )
    throw Error('Invalid or unsafe extension repository configuration');
  return config;
}

export function validateRepositoryInventory(config, sourceIds, features) {
  if (!config) return;
  const equal = (expected, actual) =>
    expected.length === actual.size && expected.every((id) => actual.has(id));
  if (!equal(config.sourceIds, sourceIds) || !equal(config.hostFeatures, features))
    throw Error('Repository inventory differs from its explicit source/feature allowlist');
}
