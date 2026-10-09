import { describe, expect, it } from 'vitest';
import { decodeList, encodeList, migrateList, parsePasted, type ModList } from '../src/lib/core/share';

const list: ModList = {
  id: 'abc',
  name: 'Survival & friends #2',
  loader: 'forge',
  target: 'v:1.20.1',
  acceptPrerelease: true,
  mods: ['AANobbMI', 'gvQqBUqZ', 'P7dR8mSH'],
};

describe('share links', () => {
  it('round-trips a list through the URL fragment', () => {
    expect(decodeList('#' + encodeList(list), () => 'new')).toEqual({ ...list, id: 'new' });
  });
  it('still opens old drop-based links', () => {
    expect(decodeList('#v=1&l=fabric&d=26.3&m=AANobbMI', () => 'x')!.target).toBe('d:26.3');
  });
  it('rejects unknown versions and loaders, and drops malformed ids/targets', () => {
    expect(decodeList('#v=2&l=fabric', () => 'x')).toBeNull();
    expect(decodeList('#v=1&l=quilt', () => 'x')).toBeNull();
    const d = decodeList('#v=1&l=fabric&t=v:<script>&m=AANobbMI.bad.AANobbMI', () => 'x')!;
    expect(d.mods).toEqual(['AANobbMI']);
    expect(d.target).toBe('');
  });
  it('migrates saved lists from the drop-only format', () => {
    expect(migrateList({ ...list, target: '', drop: '26.2' } as ModList & { drop: string })).toMatchObject({ target: 'd:26.2' });
  });
});

describe('parsePasted', () => {
  it('accepts Modrinth URLs, slugs, names and jar names', () => {
    expect(parsePasted('https://modrinth.com/mod/Lithium/versions\nsodium, Iris Shaders\nmodmenu.jar\n\nsodium')).toEqual(['lithium', 'sodium', 'iris shaders', 'modmenu']);
  });
});
