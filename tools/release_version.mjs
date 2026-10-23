import { createPrivateKey, KeyObject } from 'node:crypto';

export function releaseVersion(value) {
  if (
    typeof value !== 'string' ||
    value.length > 128 ||
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?$/u.test(
      value,
    )
  )
    throw Error('Expected a SemVer release version without a v prefix or build metadata');
  // Match the host's signed 64-bit SemVer parser, not JavaScript's float range.
  if (
    value
      .split('-')[0]
      .split('.')
      .some((part) => BigInt(part) > 9223372036854775807n)
  )
    throw Error('Release version exceeds the host integer range');
  return value;
}

export function resolveReleaseVersion({ requestedVersion, refType, refName }) {
  const requested = requestedVersion?.trim();
  const tagged =
    refType === 'tag' && typeof refName === 'string' && refName.startsWith('v')
      ? releaseVersion(refName.slice(1))
      : null;
  if (!requested && !tagged) throw Error('An existing v-prefixed release tag is required');
  const version = releaseVersion(requested || tagged);
  if (tagged && tagged !== version) throw Error('Release input does not match the Git tag');
  return version;
}

export function ed25519PrivateKey(input) {
  const key = input instanceof KeyObject ? input : createPrivateKey(input);
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519')
    throw Error('Expected an Ed25519 private signing key');
  return key;
}
