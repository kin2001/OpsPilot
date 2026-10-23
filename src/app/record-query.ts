export const recordPageSize = 25;

export type RecordCursor = { created_at: string; id: string };

export function cursorFilter(cursor: RecordCursor, direction: 'asc' | 'desc' = 'desc') {
  const comparison = direction === 'asc' ? 'gt' : 'lt';
  return `created_at.${comparison}.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.${comparison}.${cursor.id})`;
}

export function recordFilter(columns: string[], input: string, cursor: RecordCursor | null, exactMatches: string[] = [], direction: 'asc' | 'desc' = 'desc') {
  const search = filterForSearch(columns, input);
  const searchAlternatives = [...(search?.split(',') ?? []), ...exactMatches];
  if (!cursor) return searchAlternatives.length ? searchAlternatives.join(',') : null;
  if (!searchAlternatives.length) return cursorFilter(cursor, direction);
  const comparison = direction === 'asc' ? 'gt' : 'lt';
  const cursorAlternatives = [
    `created_at.${comparison}.${cursor.created_at}`,
    `and(created_at.eq.${cursor.created_at},id.${comparison}.${cursor.id})`,
  ];
  return searchAlternatives.flatMap((searchClause) => cursorAlternatives.map((cursorClause) => `and(${searchClause},${cursorClause})`)).join(',');
}

export function filterForSearch(columns: string[], input: string) {
  const term = input.normalize('NFKC').slice(0, 200).replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
  return term ? columns.map((column) => `${column}.ilike.%${term}%`).join(',') : null;
}

export function splitRecordPage<T extends RecordCursor>(rows: T[], pageSize = recordPageSize) {
  const page = rows.slice(0, pageSize);
  return { rows: page, next: rows.length > pageSize && page.length ? page[page.length - 1]! : null };
}

export async function readBoundedRows<T extends { id: string }>(
  readPage: (cursor: string | null) => Promise<T[]>,
  pageSize: number,
  maxRows: number,
) {
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0 || !Number.isSafeInteger(maxRows) || maxRows < 0) {
    throw new Error('DEPENDENCY_UNAVAILABLE');
  }

  const rows: T[] = [];
  let cursor: string | null = null;
  while (true) {
    const page = await readPage(cursor);
    if (page.length > pageSize || page.some((row, index) => row.id <= (index ? page[index - 1]!.id : cursor ?? '')) || rows.length + page.length > maxRows) {
      throw new Error('DEPENDENCY_UNAVAILABLE');
    }
    rows.push(...page);
    if (page.length < pageSize) return rows;
    cursor = page.at(-1)!.id;
  }
}
