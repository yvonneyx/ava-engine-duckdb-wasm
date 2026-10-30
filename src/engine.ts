/* eslint-env browser */
import {
  DuckDBQueryDialect, getDuckDBSchema, profileTables, DEFAULT_METRICS,
  parseProfileOptions, sqlIdentifier, sqlStringLiteral, serializeOptions,
  coerceNumbers, createResultCollector, limitedQuery, maxRows, runWithTimeout,
} from '@antv/ava/engine';
import type { DuckDBConnection } from '@antv/ava/engine';
import type { AsyncDuckDB, AsyncDuckDBConnection, DuckDBBundles } from '@duckdb/duckdb-wasm';
import type {
  AnalysisEngine, DataModel, DataSourceConfig, ExecutionOptions,
  ExecutionResult, LLMConfig, ProfileOptions, Schema,
} from '@antv/ava/browser';

export interface DuckDBWasmEngineOptions {
  /** Self-hosted bundles are recommended; defaults to the package's versioned CDN bundles. */
  bundles?: DuckDBBundles;
  queryTimeoutMs?: number;
  /** Bound network download and worker startup. Default 60 seconds. */
  loadTimeoutMs?: number;
  memoryLimit?: string;
}

function jsonValue(value: any): any {
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : String(value);
  if (value instanceof Date) return value.toISOString();
  if (value == null || typeof value !== 'object') return value;
  if (value.toJSON) return jsonValue(value.toJSON());
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return Array.from(value as any, jsonValue);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
}

/** Browser SQL engine. All input and query execution stay inside a dedicated Wasm worker. */
export class DuckDBWasmEngine implements AnalysisEngine {
  readonly language = { name: 'DuckDB SQL dialect', fence: 'sql' };
  private database: AsyncDuckDB | null = null;
  private connection: AsyncDuckDBConnection | null = null;
  private worker: Worker | null = null;
  private ready = false;

  constructor(private readonly llmConfig: LLMConfig, private readonly options: DuckDBWasmEngineOptions = {}) {}

  private async rows(sql: string): Promise<Record<string, any>[]> {
    if (!this.connection) throw new Error('No data loaded. Please call source() first.');
    const table = await this.connection.query(sql);
    return table.toArray().map((row) => jsonValue(row));
  }

  private async preparedRows(sql: string): Promise<Record<string, any>[]> {
    // DuckDB prepare rejects multiple statements. The outer SELECT limits the grammar to read-only queries.
    const statement = await this.connection!.prepare(sql);
    try {
      return (await statement.query()).toArray().map((row) => jsonValue(row));
    } finally {
      await statement.close();
    }
  }

  private adapter(): DuckDBConnection {
    return {
      run: (sql) => this.rows(sql),
      runAndReadAll: async (sql) => {
        const rows = await this.rows(sql);
        return { getRowObjectsJson: () => rows };
      },
    };
  }

  private bounded<T>(operation: Promise<T>): Promise<T> {
    return runWithTimeout(operation, this.options.queryTimeoutMs ?? 30000, {
      onTimeout: () => {
        void this.dispose();
        return new Error('DuckDB query timed out; the browser engine was stopped. Reload the source to continue.');
      },
    });
  }

  async load(config: DataSourceConfig): Promise<void> {
    await this.dispose();
    if (config.type !== 'csv') throw new Error('Browser DuckDB supports inline csv sources.');
    const download = new AbortController();
    let moduleURL: string | undefined;
    try {
      await runWithTimeout(
        (async () => {
          const { AsyncDuckDB, VoidLogger, getJsDelivrBundles, selectBundle } = await import('@duckdb/duckdb-wasm');
          const bundle = await selectBundle(this.options.bundles ?? getJsDelivrBundles());
          if (!bundle.mainWorker) throw new Error('DuckDB worker bundle is missing');
          try {
            const response = await fetch(bundle.mainModule, { signal: download.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            moduleURL = URL.createObjectURL(await response.blob());
          } catch (error) {
            throw new Error(`DuckDB Wasm download failed: ${error instanceof Error ? error.message : String(error)}`);
          }
          const workerURL = new URL(bundle.mainWorker, location.href);
          const crossOrigin = workerURL.origin !== location.origin;
          const url = crossOrigin
            ? URL.createObjectURL(
                new Blob([`importScripts(${JSON.stringify(workerURL.href)})`], { type: 'text/javascript' })
              )
            : workerURL.href;
          try {
            this.worker = new Worker(url);
          } finally {
            if (crossOrigin) URL.revokeObjectURL(url);
          }
          const workerFailure = new Promise<never>((_resolve, reject) => {
            this.worker!.addEventListener(
              'error',
              () => reject(new Error('DuckDB worker failed to load; check network access and worker URLs')),
              { once: true }
            );
          });
          this.database = new AsyncDuckDB(new VoidLogger(), this.worker);
          await Promise.race([this.database.instantiate(moduleURL), workerFailure]);
          await this.database.open({ query: { castBigIntToDouble: false, castDecimalToDouble: false } });
          this.connection = await this.database.connect();
          await this.bounded(
            (async () => {
              await this.rows(`SET memory_limit = ${sqlStringLiteral(this.options.memoryLimit ?? '512MB')}`);
              await this.rows('SET threads = 1');
              await this.rows('SET autoinstall_known_extensions = false');
              await this.rows('SET autoload_known_extensions = false');
              await this.database!.registerFileText('input.csv', config.options.csv);
              await this.rows(
                `CREATE TABLE data AS SELECT * FROM read_csv('input.csv', header=true${serializeOptions(
                  config.options.options
                )})`
              );
              await this.rows('SET enable_external_access = false');
              await this.rows('SET lock_configuration = true');
              this.ready = true;
            })()
          );
        })(),
        this.options.loadTimeoutMs ?? 60000,
        {
          onTimeout: () => {
            download.abort();
            void this.dispose();
            return new Error('DuckDB initialization timed out; check your network and retry.');
          },
        }
      );
    } catch (error) {
      await this.dispose();
      throw error;
    } finally {
      download.abort();
      if (moduleURL) URL.revokeObjectURL(moduleURL);
    }
  }

  async schema(): Promise<Schema> {
    if (!this.ready) throw new Error('No data loaded. Please call source() first.');
    return this.bounded(getDuckDBSchema(this.adapter(), ['data']));
  }

  async profile(schema: Schema, options: ProfileOptions = {}) {
    if (!this.ready) throw new Error('No data loaded. Please call source() first.');
    return this.bounded(
      profileTables(this.adapter(), schema, parseProfileOptions(options, { metrics: DEFAULT_METRICS }))
    );
  }

  async getDSL(query: string, dataModel: DataModel): Promise<string> {
    if (!this.ready) throw new Error('No data loaded. Please call source() first.');
    return new DuckDBQueryDialect(this.llmConfig).getDSL(query, dataModel);
  }

  async execute<T = Record<string, unknown>>(sql: string, options: ExecutionOptions = {}): Promise<ExecutionResult<T>> {
    if (!this.ready) throw new Error('No data loaded. Please call source() first.');
    return this.bounded(
      (async () => {
        const query = limitedQuery(sql, maxRows(options));
        const columns = await this.preparedRows(`DESCRIBE ${query}`);
        const schema = columns.map((column) => ({
          name: String(column.column_name),
          type: String(column.column_type),
        }));
        // Keep wide integers and decimals exact across the Arrow/JavaScript boundary.
        const fields = schema.map(({ name, type }) =>
          /^(U?(BIGINT|HUGEINT)|DECIMAL\([^)]*\))$/i.test(type)
            ? `CAST(${sqlIdentifier(name)} AS VARCHAR) AS ${sqlIdentifier(name)}`
            : sqlIdentifier(name)
        );
        const statement = await this.connection!.prepare(`SELECT ${fields.join(', ')} FROM (${query}) AS __ava_result`);
        try {
          const reader = await statement.send();
          const collector = createResultCollector<T>(schema, options);
          for await (const batch of reader) {
            for (const row of batch) {
              const value = coerceNumbers([jsonValue(row)], schema)[0] as T;
              if (!collector.add(value)) return collector.result();
            }
          }
          return collector.result();
        } finally {
          await statement.close();
        }
      })()
    );
  }

  async dispose(): Promise<void> {
    const database = this.database;
    this.ready = false;
    this.database = null;
    this.connection = null;
    this.worker?.terminate();
    this.worker = null;
    await database?.terminate();
  }
}
