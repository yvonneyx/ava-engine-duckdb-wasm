import { expect, it, vi } from 'vitest';
import { getDuckDBSchema } from '../src/duckdb/util/schema';
import { profileTables } from '../src/duckdb/profile';
import { parseProfileOptions } from '../src/util/profile';
import { serializeOptions } from '../src/util/sql';

it('escapes reader options and rejects unsupported values', () => {
  expect(serializeOptions({ delim: "'" })).toContain('"delim"=' + "''''");
  expect(() => serializeOptions({ delim: { nested: 1 } } as never)).toThrow('unsupported value');
});

it('builds schema and profile from the DuckDB adapter', async () => {
  const runAndReadAll = vi.fn()
    .mockResolvedValueOnce({ getRowObjectsJson: () => [
      { kind: 'table', table_name: 'data', metadata: { catalog: 'memory', schema: 'main' } },
      { kind: 'column', table_name: 'data', metadata: { name: 'sales', type: 'INTEGER', position: 1, notNull: false } },
    ] })
    .mockResolvedValueOnce({ getRowObjectsJson: () => [{ m0: 2, m1: 0, m2: 3.5 }] });
  const connection = { run: vi.fn(), runAndReadAll };
  const schema = await getDuckDBSchema(connection, ['data']);
  expect(schema.models[0].columns).toEqual([{ name: 'sales', type: 'INTEGER', notNull: false }]);
  const profile = await profileTables(connection, schema, parseProfileOptions({ metrics: ['row_count', 'null_count', 'mean'] }, {}));
  expect(profile.models[0].metrics).toEqual({ row_count: 2 });
  expect(profile.models[0].columns[0].metrics).toEqual({ null_count: 0, mean: 3.5 });
  expect(runAndReadAll).toHaveBeenCalledTimes(2);
});
