import { describe, expect, it } from 'vitest';
import { isModPath, majorityLoader, parseFabricModJson, parseModsToml, parsePackIndex, summariseImport } from '../src/lib/core/import';

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);

describe('parsePackIndex', () => {
  it('reads the pack name, loader, version and mod hashes', () => {
    const pack = parsePackIndex(
      JSON.stringify({
        name: 'My Pack',
        dependencies: { minecraft: '1.21.1', neoforge: '21.1.0' },
        files: [
          { path: 'mods/a.jar', hashes: { sha1: H1 } },
          { path: 'mods/a-copy.jar', hashes: { sha1: H1 } },
          { path: 'mods/b.jar', hashes: { sha1: H2.toUpperCase() } },
          { path: 'resourcepacks/x.zip', hashes: { sha1: 'c'.repeat(40) } },
          { path: 'mods/bad-hash.jar', hashes: { sha1: 'nope' } },
        ],
      }),
    );
    expect(pack).toEqual({ name: 'My Pack', loader: 'neoforge', gameVersion: '1.21.1', hashes: [H1, H2] });
  });
  it('maps fabric-loader and tolerates a missing loader', () => {
    expect(parsePackIndex('{"files":[],"dependencies":{"fabric-loader":"0.16"}}').loader).toBe('fabric');
    expect(parsePackIndex('{"files":[],"dependencies":{"quilt-loader":"0.2"}}').loader).toBeNull();
  });
  it('rejects anything that is not a pack index', () => {
    expect(() => parsePackIndex('{"hello":1}')).toThrow();
    expect(() => parsePackIndex('not json')).toThrow();
  });
});

describe('jar metadata', () => {
  it('recognises mod paths only', () => {
    expect(isModPath('mods/x.jar')).toBe(true);
    expect(isModPath('overrides/mods/x.jar')).toBe(true);
    expect(isModPath('overrides\\mods\\x.jar')).toBe(true);
    expect(isModPath('config/x.jar')).toBe(false);
    expect(isModPath('mods/x.txt')).toBe(false);
  });
  it('reads fabric.mod.json', () => {
    expect(parseFabricModJson('{"id":"sodium","name":"Sodium"}')).toEqual({ id: 'sodium', name: 'Sodium', loader: 'fabric' });
  });
  it('reads mods.toml, ignoring dependency blocks and templates', () => {
    const toml = `modLoader="javafml"\n[[mods]]\nmodId="create"\ndisplayName="Create"\n[[dependencies.create]]\nmodId="minecraft"\n`;
    expect(parseModsToml(toml, 'forge')).toEqual({ id: 'create', name: 'Create', loader: 'forge' });
    expect(parseModsToml(`[[mods]]\nmodId = 'x'\ndisplayName = "\${file.jarVersion}"`, 'neoforge').name).toBeNull();
    expect(parseModsToml('nothing here', 'forge').id).toBeNull();
  });
  it('picks the most common loader', () => {
    expect(majorityLoader(['forge', 'fabric', 'fabric', null])).toBe('fabric');
    expect(majorityLoader([null])).toBeNull();
  });
});

describe('summariseImport', () => {
  it('reports matches, name guesses and misses', () => {
    expect(summariseImport({ found: 1, byName: [], missing: [] })).toBe('Added 1 mod.');
    const s = summariseImport({ found: 3, byName: ['a.jar → A'], missing: ['b.jar'], skipped: 2 });
    expect(s).toContain('Added 3 mods');
    expect(s).toContain('a.jar → A');
    expect(s).toContain('b.jar');
    expect(s).toContain('Skipped 2');
  });
});
