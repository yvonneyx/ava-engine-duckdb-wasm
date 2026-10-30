import { utf8ByteLength } from './bytes.js';
import type { ExecutionOptions, ExecutionResult, QueryColumn } from '../types.js';

export function maxRows(options: ExecutionOptions = {}): number {
  const value = Math.floor(options.maxRows ?? 200);
  return Number.isSafeInteger(value) ? Math.min(Math.max(value, 1), 1_000_000) : 200;
}

export function limitedQuery(sql: string, limit: number): string {
  const query = sql.trim().replace(/;+\s*$/, '');
  return `SELECT * FROM (\n${query}\n) AS __ava_query LIMIT ${limit + 1}`;
}

export function createResultCollector<T>(schema: QueryColumn[], options: ExecutionOptions = {}) {
  const limit = maxRows(options);
  const configuredBytes = options.maxResultBytes ?? 1024 * 1024;
  const maxBytes = Number.isFinite(configuredBytes) ? Math.max(Math.floor(configuredBytes), 1) : 1024 * 1024;
  const data: T[] = [];
  let bytes = 0;
  let truncatedBy: ExecutionResult<T>['truncatedBy'];
  const serializedBytes = (value: unknown) => utf8ByteLength(JSON.stringify(value) ?? '');

  return {
    add(row: T) {
      if (data.length >= limit) {
        truncatedBy = 'maxRows';
        return false;
      }
      const fields = row !== null && typeof row === 'object' && !Array.isArray(row) ? Object.values(row) : [row];
      if (fields.some((field) => serializedBytes(field) > 1024 * 1024)) {
        throw new Error('Result field exceeds the 1 MiB limit');
      }
      const rowBytes = serializedBytes(row);
      if (bytes + rowBytes > maxBytes) {
        truncatedBy = 'maxResultBytes';
        return false;
      }
      data.push(row);
      bytes += rowBytes;
      return true;
    },
    result(): ExecutionResult<T> {
      return {
        data,
        ...(truncatedBy ? { truncated: true, truncatedBy } : {}),
        schema,
        rowCount: truncatedBy ? undefined : data.length,
      };
    },
  };
}
