// Pins the API and collector systemd sandbox (finding #12174).
// The API's full set lives in the tracked drop-in; the collector carries the
// same directives in its unit. NoNewPrivileges on the API unit is the setuid
// floor the drop-in also sets — mase has NOPASSWD sudo.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

/** Assignment lines only. Comments and section headers are not settings. */
function directives(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('[')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    map.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return map;
}

// Shared house set. MemoryMax differs: the API was measured, the collector
// uses the 512M floor. Empty CapabilityBoundingSet is a real setting.
const HOUSE: ReadonlyArray<readonly [string, string]> = [
  ['NoNewPrivileges', 'yes'],
  ['ProtectSystem', 'strict'],
  ['ProtectHome', 'tmpfs'],
  ['PrivateTmp', 'yes'],
  ['PrivateDevices', 'yes'],
  ['ProtectKernelTunables', 'yes'],
  ['ProtectKernelModules', 'yes'],
  ['ProtectControlGroups', 'yes'],
  ['ProtectClock', 'yes'],
  ['ProtectHostname', 'yes'],
  ['RestrictNamespaces', 'yes'],
  ['RestrictRealtime', 'yes'],
  ['RestrictSUIDSGID', 'yes'],
  ['LockPersonality', 'yes'],
  ['RestrictAddressFamilies', 'AF_UNIX AF_INET AF_INET6'],
  ['CapabilityBoundingSet', ''],
  ['IPAddressDeny', '169.254.0.0/16'],
  ['BindReadOnlyPaths', '/home/mase/Projects/spot-price'],
];

function expectHouse(unit: Map<string, string>, memoryMax: string): void {
  for (const [key, value] of HOUSE) {
    expect(unit.get(key), key).toBe(value);
  }
  expect(unit.get('MemoryMax')).toBe(memoryMax);
  expect(unit.has('MemoryDenyWriteExecute')).toBe(false);
}

describe('deploy/spot-price.service (finding #12174)', () => {
  const unit = directives(read('deploy/spot-price.service'));

  it('blocks setuid in the tracked unit, not only the host drop-in', () => {
    expect(unit.get('NoNewPrivileges')).toBe('yes');
  });

  it('does not set ProtectHome — the drop-in owns the tmpfs plus the project bind', () => {
    expect(unit.has('ProtectHome')).toBe(false);
  });
});

describe('deploy/spot-price.service.d/20-sandbox.conf (finding #12174)', () => {
  const dropin = directives(read('deploy/spot-price.service.d/20-sandbox.conf'));

  it('keeps the measured house sandbox', () => {
    expectHouse(dropin, '1G');
  });
});

describe('deploy/spot-price-collector.service (finding #12174)', () => {
  const unit = directives(read('deploy/spot-price-collector.service'));

  it('runs the same house sandbox as the API, at the 512M floor', () => {
    expectHouse(unit, '512M');
  });
});
