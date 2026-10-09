import { describe, expect, it } from 'vitest';
import { decodeList, encodeList, parsePasted, type ModList } from '../src/lib/core/share';

const list: ModList = {
  id: 'abc',
  name: 'Survival & friends #2',
  loader: 'neoforge',
  drop: '26.3',
  acceptPrerelease: true,
  mods: ['AANobbMI', 'gvQqBUqZ', 'P7dR8mSH'],
};

describe('share links', () => {
  it('round-trips a list through the URL fragment', () => {
    const decoded = decodeList('#' + encodeList(list), () => 'new');
    expect(decoded).toEqual({ ...list, id: 'new' });
  });
  it('rejects unknown versions and loaders, and drops malformed ids', () => {
    expect(decodeList('#v=2&l=fabric', () => 'x')).toBeNull();
    expect(decodeList('#v=1&l=forge', () => 'x')).toBeNull();
    expect(decodeList('#v=1&l=fabric&m=AANobbMI.bad.AANobbMI.<script>', () => 'x')!.mods).toEqual(['AANobbMI']);
  });
});

describe('parsePasted', () => {
  it('accepts Modrinth URLs, slugs, names and jar names', () => {
    expect(parsePasted('https://modrinth.com/mod/Lithium/versions\nsodium, Iris Shaders\nmodmenu.jar\n\nsodium')).toEqual([
      'lithium',
      'sodium',
      'iris shaders',
      'modmenu',
    ]);
  });
});
