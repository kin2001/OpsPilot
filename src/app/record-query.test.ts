import { describe, expect, it, vi } from 'vitest';
import { cursorFilter, filterForSearch, readBoundedRows, recordFilter, splitRecordPage, type RecordCursor } from './record-query';

describe('bounded record queries', () => {
  it('removes filter syntax and wildcard characters from untrusted search text', () => {
    expect(filterForSearch(['name', 'code'], 'ALPHA-01%,or(id.eq.abc),*')).toBe('name.ilike.%ALPHA-01 or id eq abc%,code.ilike.%ALPHA-01 or id eq abc%');
    expect(filterForSearch(['title'], '   ')).toBeNull();
    expect(filterForSearch(['title'], 'Pump #7')).toBe('title.ilike.%Pump 7%');
  });

  it('uses a stable timestamp and ID cursor across equal timestamps', () => {
    const cursor: RecordCursor = { created_at: '2026-10-23T04:05:06.000Z', id: 'c2daf4c7-e68c-4783-87c6-26b009a1169d' };
    expect(cursorFilter(cursor)).toBe('created_at.lt.2026-10-23T04:05:06.000Z,and(created_at.eq.2026-10-23T04:05:06.000Z,id.lt.c2daf4c7-e68c-4783-87c6-26b009a1169d)');
    expect(cursorFilter(cursor, 'asc')).toBe('created_at.gt.2026-10-23T04:05:06.000Z,and(created_at.eq.2026-10-23T04:05:06.000Z,id.gt.c2daf4c7-e68c-4783-87c6-26b009a1169d)');
  });

  it('combines server search and cursor branches with AND semantics in one PostgREST OR filter', () => {
    const cursor: RecordCursor = { created_at: '2026-10-23T04:05:06.000Z', id: 'c2daf4c7-e68c-4783-87c6-26b009a1169d' };
    expect(recordFilter(['name', 'code'], 'pump', cursor)).toBe('and(name.ilike.%pump%,created_at.lt.2026-10-23T04:05:06.000Z),and(name.ilike.%pump%,and(created_at.eq.2026-10-23T04:05:06.000Z,id.lt.c2daf4c7-e68c-4783-87c6-26b009a1169d)),and(code.ilike.%pump%,created_at.lt.2026-10-23T04:05:06.000Z),and(code.ilike.%pump%,and(created_at.eq.2026-10-23T04:05:06.000Z,id.lt.c2daf4c7-e68c-4783-87c6-26b009a1169d))');
    expect(recordFilter(['name', 'code'], '', cursor)).toBe(cursorFilter(cursor));
    expect(recordFilter(['name'], '', cursor, [], 'asc')).toBe(cursorFilter(cursor, 'asc'));
    expect(recordFilter(['name', 'code'], 'pump', null)).toBe(filterForSearch(['name', 'code'], 'pump'));
    expect(recordFilter(['title', 'category'], 'WO-0007', null, ['number.eq.7']))
      .toBe('title.ilike.%WO-0007%,category.ilike.%WO-0007%,number.eq.7');
  });

  it('returns a next cursor only when an additional row proves there is another page', () => {
    const rows = Array.from({ length: 4 }, (_, index) => ({ id: `id-${index}`, created_at: `2026-10-23T00:00:0${index}.000Z` }));
    expect(splitRecordPage(rows, 3)).toEqual({ rows: rows.slice(0, 3), next: rows[2] });
    expect(splitRecordPage(rows.slice(0, 3), 3)).toEqual({ rows: rows.slice(0, 3), next: null });
  });

  it('reads the empty continuation after a full capped page and fails closed past its bound', async () => {
    const rows = Array.from({ length: 2501 }, (_, index) => ({ id: `id-${String(index + 1).padStart(4, '0')}` }));
    const readPage = vi.fn(async (cursor: string | null) => rows.filter((row) => !cursor || row.id > cursor).slice(0, 100));
    const exactRows = rows.slice(0, 2500);
    const readExactPage = vi.fn(async (cursor: string | null) => exactRows.filter((row) => !cursor || row.id > cursor).slice(0, 100));

    await expect(readBoundedRows(readExactPage, 100, 2500)).resolves.toEqual(exactRows);
    expect(readExactPage).toHaveBeenCalledTimes(26);
    expect(readExactPage.mock.calls.at(-1)?.[0]).toBe('id-2500');
    await expect(readBoundedRows(readPage, 100, 2500)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
    expect(readPage).toHaveBeenCalledTimes(26);
  });
});
