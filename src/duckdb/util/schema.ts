import { sqlStringLiteral } from '../../util/sql.js';
import type { DuckDBConnection, Schema } from '../../types.js';

/** Discover the tables created from CSV and their columns. */
export async function getDuckDBSchema(conn: DuckDBConnection, tableNames?: string[]): Promise<Schema> {
  if (tableNames?.length === 0) return { models: [], relationships: [], views: [] };
  const names = tableNames?.map(sqlStringLiteral).join(', ');
  const filter = names === undefined ? 'TRUE' : `table_name IN (${names})`;
  const sql = `
SELECT 'table' AS kind, table_name,
  struct_pack(catalog := database_name, schema := schema_name) AS metadata
FROM duckdb_tables()
WHERE database_name = current_database() AND schema_name = current_schema()
  AND ${filter} AND NOT internal
UNION ALL
SELECT 'column' AS kind, table_name,
  struct_pack(name := column_name, type := data_type, notNull := NOT is_nullable, "position" := column_index) AS metadata
FROM duckdb_columns()
WHERE database_name = current_database() AND schema_name = current_schema() AND ${filter}`;
  const rows = (await conn.runAndReadAll(sql)).getRowObjectsJson();
  const models = new Map<string, Schema['models'][number]>();
  const columns = new Map<string, Array<{ name: string; type: string; notNull: boolean; position: number }>>();
  for (const row of rows) {
    const name = String(row.table_name);
    const meta = (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) as Record<string, unknown>;
    if (row.kind === 'table') {
      models.set(name, {
        name,
        tableReference: { table: name, catalog: String(meta.catalog), schema: String(meta.schema) },
        columns: [],
      });
    } else if (row.kind === 'column') {
      const list = columns.get(name) ?? [];
      list.push({ name: String(meta.name), type: String(meta.type), notNull: meta.notNull === true || meta.notNull === 1, position: Number(meta.position) });
      columns.set(name, list);
    }
  }
  for (const [name, model] of models) {
    model.columns = (columns.get(name) ?? []).sort((a, b) => a.position - b.position)
      .map(({ name, type, notNull }) => ({ name, type, notNull }));
  }
  return { models: [...models.values()].sort((a, b) => a.name.localeCompare(b.name)), relationships: [], views: [] };
}
