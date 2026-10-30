import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import * as duckdb from '@duckdb/duckdb-wasm/blocking';
import { getDuckDBSchema } from '../src/duckdb/util/schema.js';
import { profileTables } from '../src/duckdb/profile.js';
import { DEFAULT_METRICS, parseProfileOptions } from '../src/util/profile.js';

it('discovers and profiles an actual DuckDB-Wasm table', async () => {
  const require = createRequire(import.meta.url);
  const db = await duckdb.createDuckDB(
    { mvp: { mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm') } },
    new duckdb.VoidLogger(), duckdb.NODE_RUNTIME
  );
  await db.instantiate();
  const conn = db.connect();
  try {
    conn.query("CREATE TABLE data AS SELECT * FROM (VALUES ('East', 3), ('West', 7), ('East', 4)) AS t(region, sales)");
    const adapter = {
      run: async (sql: string) => conn.query(sql),
      runAndReadAll: async (sql: string) => ({ getRowObjectsJson: () => conn.query(sql).toArray().map(row => row.toJSON()) }),
    };
    const schema = await getDuckDBSchema(adapter, ['data']);
    expect(schema.models[0].columns.map(column => column.name)).toEqual(['region', 'sales']);
    const profile = await profileTables(adapter, schema, parseProfileOptions({}, { metrics: DEFAULT_METRICS }));
    expect(profile.models[0].metrics.row_count).toBe(3);
    expect(profile.models[0].columns[1].metrics).toMatchObject({ min: 3, max: 7 });
  } finally {
    conn.close();
  }
});
