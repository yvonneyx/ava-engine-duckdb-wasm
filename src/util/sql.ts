/**
 * Shared SQL quoting/composition helpers and DuckDB reader options.
 */

import type { CSVReadOptions } from '../types.js';

/** Escape a string for safe embedding in a SQL string literal */
export function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

/** Quote a value as a SQL string literal */
export function sqlStringLiteral(value: string): string {
  return `'${escapeSql(value)}'`;
}

/** Quote a SQL identifier (database/schema/table name) */
export function sqlIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Serialize a single DuckDB reader option value (string/number/boolean/array/map) */
function serializeOptionValue(value: unknown): string | null {
  if (typeof value === 'string') return sqlStringLiteral(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return `[${value.map(sqlStringLiteral).join(', ')}]`;
  }
  if (
    value &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
    Object.values(value).every((item) => typeof item === 'string')
  ) {
    const entries = Object.entries(value as Record<string, string>).map(
      ([key, item]) => `${sqlStringLiteral(key)}: ${sqlStringLiteral(item)}`
    );
    return `{${entries.join(', ')}}`;
  }
  return null;
}

/**
 * Serialize DuckDB reader options into a `, key=value, ...` SQL fragment for
 * read_csv/read_json/read_xlsx. Only undefined values are skipped; unsupported values throw.
 */
export function serializeOptions(options?: CSVReadOptions): string {
  if (!options) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue;
    const serialized = serializeOptionValue(value);
    if (serialized === null) throw new Error(`Invalid DuckDB reader option "${key}": unsupported value`);
    parts.push(`${sqlIdentifier(key)}=${serialized}`);
  }
  return parts.length > 0 ? `, ${parts.join(', ')}` : '';
}
