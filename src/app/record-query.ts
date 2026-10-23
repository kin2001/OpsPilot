export const recordPageSize = 25;

export type RecordCursor = { created_at: string; id: string };

export function cursorFilter(cursor: RecordCursor) {
  return `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`;
}

export function recordFilter(columns: string[], input: string, cursor: RecordCursor | null, exactMatches: string[] = []) {
  const search = filterForSearch(columns, input);
  const searchAlternatives = [...(search?.split(',') ?? []), ...exactMatches];
  if (!cursor) return searchAlternatives.length ? searchAlternatives.join(',') : null;
  if (!searchAlternatives.length) return cursorFilter(cursor);
  const cursorAlternatives = [
    `created_at.lt.${cursor.created_at}`,
    `and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
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
