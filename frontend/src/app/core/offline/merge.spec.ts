import { merge3, mergeJsonText, setAtPath } from './merge';

describe('three-way merge', () => {
  it('keeps both sides when they changed different fields', () => {
    const r = merge3(
      { title: 'A', comune: 'Bologna' },
      { title: 'B', comune: 'Bologna' },
      { title: 'A', comune: 'Imola' },
    );
    expect(r).toEqual({ merged: { title: 'B', comune: 'Imola' }, clashes: [] });
  });

  it('reports a field changed on both sides and keeps mine', () => {
    const r = merge3(
      { operazioni: 'scavo' },
      { operazioni: 'scavo trincea 1' },
      { operazioni: 'scavo trincea 2' },
    );
    expect(r.merged).toEqual({ operazioni: 'scavo trincea 1' });
    expect(r.clashes).toEqual([
      { path: 'operazioni', base: 'scavo', mine: 'scavo trincea 1', theirs: 'scavo trincea 2' },
    ]);
  });

  it('merges records of a list by identity, so two people logging themselves both stay', () => {
    const base = { presenze: [{ name: 'Rossi', hours_start: '08:00' }] };
    const mine = {
      presenze: [{ name: 'Rossi', hours_start: '08:00', hours_end: '17:00' }, { name: 'Verdi' }],
    };
    const theirs = { presenze: [{ name: 'Rossi', hours_start: '07:30' }, { name: 'Bianchi' }] };
    const r = merge3(base, mine, theirs);
    expect(r.clashes).toEqual([]);
    expect(r.merged).toEqual({
      presenze: [
        { name: 'Rossi', hours_start: '07:30', hours_end: '17:00' },
        { name: 'Bianchi' },
        { name: 'Verdi' },
      ],
    });
  });

  it('takes the later timestamp without calling it a clash', () => {
    const r = merge3(
      { updated_at: '2026-01-01', a: 1 },
      { updated_at: '2026-01-03', a: 2 },
      { updated_at: '2026-01-02', a: 1 },
    );
    expect(r).toEqual({ merged: { updated_at: '2026-01-03', a: 2 }, clashes: [] });
  });

  it('respects a deletion made on one side only', () => {
    expect(merge3({ a: 1, b: 2 }, { a: 1 }, { a: 1, b: 2 }).merged).toEqual({ a: 1 });
  });

  it('merges a file both sides created (same day) from an empty base', () => {
    const r = mergeJsonText(
      null,
      JSON.stringify({ date: '2026-11-24', presenze: [{ name: 'Rossi' }] }),
      JSON.stringify({ date: '2026-11-24', presenze: [{ name: 'Verdi' }], meteo: 'sereno' }),
    );
    expect(r!.clashes).toEqual([]);
    expect(JSON.parse(r!.text)).toEqual({
      date: '2026-11-24',
      presenze: [{ name: 'Verdi' }, { name: 'Rossi' }],
      meteo: 'sereno',
    });
  });

  it('gives up on text that is not JSON', () => {
    expect(mergeJsonText('# a', '# b', '# c')).toBeNull();
  });

  it('can put one clashing value back by path', () => {
    const doc = { presenze: [{ name: 'Rossi', hours_end: '17:00' }], note: 'x' };
    expect(setAtPath(doc, 'presenze[Rossi].hours_end', '16:00')).toEqual({
      presenze: [{ name: 'Rossi', hours_end: '16:00' }],
      note: 'x',
    });
    expect(setAtPath(doc, 'note', undefined)).toEqual({
      presenze: [{ name: 'Rossi', hours_end: '17:00' }],
    });
  });
});
