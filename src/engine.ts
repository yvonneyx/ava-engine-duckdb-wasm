/* eslint-env browser */
import { DuckDBQueryDialect } from './query/duckdb.js';
import { getDuckDBSchema } from './duckdb/util/schema.js';
import { profileTables, DEFAULT_METRICS } from './duckdb/profile.js';
import { parseProfileOptions } from './util/profile.js';
import { sqlIdentifier, sqlStringLiteral, serializeOptions } from './util/sql.js';
import { coerceNumbers } from './util/coerce.js';
import { createResultCollector, limitedQuery, maxRows } from './util/result.js';
import { runWithTimeout } from './util/timeout.js';
import type { DuckDBConnection } from './types.js';
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
  private generation = 0;
  private cancelLoad: (() => void) | null = null;

  constructor(private readonly llmConfig: LLMConfig, private readonly options: DuckDBWasmEngineOptions = {}) {}

  private async rows(sql: string, connection = this.connection): Promise<Record<string, any>[]> {
    if (!connection) throw new Error('No data loaded. Please call source() first.');
    const table = await connection.query(sql);
    return table.toArray().map((row) => jsonValue(row));
  }

  private async preparedRows(sql: string, connection: AsyncDuckDBConnection): Promise<Record<string, any>[]> {
    // DuckDB prepare rejects multiple statements. The outer SELECT limits the grammar to read-only queries.
    const statement = await connection.prepare(sql);
    try {
      return (await statement.query()).toArray().map((row) => jsonValue(row));
    } finally {
      await statement.close();
    }
  }

  private adapter(connection: AsyncDuckDBConnection): DuckDBConnection {
    return {
      run: (sql) => this.rows(sql, connection),
      runAndReadAll: async (sql) => {
        const rows = await this.rows(sql, connection);
        return { getRowObjectsJson: () => rows };
      },
    };
  }

  private bounded<T>(operation: Promise<T>): Promise<T> {
    const generation = this.generation;
    return runWithTimeout(operation, this.options.queryTimeoutMs ?? 30000, {
      onTimeout: () => {
        if (this.generation === generation) void this.dispose();
        return new Error('DuckDB query timed out; the browser engine was stopped. Reload the source to continue.');
      },
    });
  }

  async load(config: DataSourceConfig): Promise<void> {
    const generation = ++this.generation;
    await this.closeResources();
    if (generation !== this.generation) throw new Error('DuckDB initialization was cancelled');
    if (config.type !== 'csv') throw new Error('Browser DuckDB supports inline csv sources.');

    const download = new AbortController();
    let worker: Worker | null = null;
    let database: AsyncDuckDB | null = null;
    let moduleURL: string | undefined;
    let cancelled = false;
    let rejectCancellation!: (error: Error) => void;
    const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
    const check = () => {
      if (cancelled || generation !== this.generation) throw new Error('DuckDB initialization was cancelled');
    };
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      rejectCancellation(new Error('DuckDB initialization was cancelled'));
      download.abort();
      worker?.terminate();
      worker = null;
      const current = database;
      database = null;
      if (current) void current.terminate().catch(() => {});
    };
    this.cancelLoad = cancel;
    try {
      await runWithTimeout(Promise.race([(async () => {
        const { AsyncDuckDB, VoidLogger, getJsDelivrBundles, selectBundle } = await import('@duckdb/duckdb-wasm');
        check();
        const bundle = await selectBundle(this.options.bundles ?? getJsDelivrBundles());
        check();
        if (!bundle.mainWorker) throw new Error('DuckDB worker bundle is missing');
        try {
          const response = await fetch(bundle.mainModule, { signal: download.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          check();
          moduleURL = URL.createObjectURL(blob);
        } catch (error) {
          throw new Error(`DuckDB Wasm download failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        const workerURL = new URL(bundle.mainWorker, location.href);
        const crossOrigin = workerURL.origin !== location.origin;
        const url = crossOrigin
          ? URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(workerURL.href)})`], { type: 'text/javascript' }))
          : workerURL.href;
        try {
          worker = new Worker(url);
        } finally {
          if (crossOrigin) URL.revokeObjectURL(url);
        }
        const workerFailure = new Promise<never>((_resolve, reject) => {
          worker!.addEventListener('error', () => reject(new Error('DuckDB worker failed to load; check network access and worker URLs')), { once: true });
        });
        database = new AsyncDuckDB(new VoidLogger(), worker);
        const db = database;
        await Promise.race([db.instantiate(moduleURL), workerFailure]);
        check();
        await db.open({ query: { castBigIntToDouble: false, castDecimalToDouble: false } });
        check();
        const connection = await db.connect();
        check();
        const setup = async () => {
          const run = async (sql: string) => { check(); await this.rows(sql, connection); check(); };
          await run(`SET memory_limit = ${sqlStringLiteral(this.options.memoryLimit ?? '512MB')}`);
          await run('SET threads = 1');
          await run('SET autoinstall_known_extensions = false');
          await run('SET autoload_known_extensions = false');
          await db.registerFileText('input.csv', config.options.csv);
          check();
          await run(`CREATE TABLE data AS SELECT * FROM read_csv('input.csv', header=true${serializeOptions(config.options.options)})`);
          await run('SET enable_external_access = false');
          await run('SET lock_configuration = true');
        };
        await runWithTimeout(setup(), this.options.queryTimeoutMs ?? 30000, {
          onTimeout: () => { cancel(); return new Error('DuckDB query timed out; the browser engine was stopped. Reload the source to continue.'); },
        });
        check();
        this.database = db;
        this.connection = connection;
        this.worker = worker;
        this.ready = true;
        database = null;
        worker = null;
      })(), cancellation]), this.options.loadTimeoutMs ?? 60000, {
        onTimeout: () => { cancel(); return new Error('DuckDB initialization timed out; check your network and retry.'); },
      });
    } catch (error) {
      cancel();
      throw error;
    } finally {
      if (this.cancelLoad === cancel) this.cancelLoad = null;
      download.abort();
      if (moduleURL) URL.revokeObjectURL(moduleURL);
    }
  }

  async schema(): Promise<Schema> {
    if (!this.ready) throw new Error('No data loaded. Please call source() first.');
    return this.bounded(getDuckDBSchema(this.adapter(this.connection!), ['data']));
  }

  async profile(schema: Schema, options: ProfileOptions = {}) {
    if (!this.ready) throw new Error('No data loaded. Please call source() first.');
    return this.bounded(
      profileTables(this.adapter(this.connection!), schema, parseProfileOptions(options, { metrics: DEFAULT_METRICS }))
    );
  }

  async getDSL(query: string, dataModel: DataModel): Promise<string> {
    if (!this.ready) throw new Error('No data loaded. Please call source() first.');
    return new DuckDBQueryDialect(this.llmConfig).getDSL(query, dataModel);
  }

  async execute<T = Record<string, unknown>>(sql: string, options: ExecutionOptions = {}): Promise<ExecutionResult<T>> {
    if (!this.ready) throw new Error('No data loaded. Please call source() first.');
    const connection = this.connection!;
    return this.bounded(
      (async () => {
        const query = limitedQuery(sql, maxRows(options));
        const columns = await this.preparedRows(`DESCRIBE ${query}`, connection);
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
        const statement = await connection.prepare(`SELECT ${fields.join(', ')} FROM (${query}) AS __ava_result`);
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
    ++this.generation;
    await this.closeResources();
  }

  private async closeResources(): Promise<void> {
    this.cancelLoad?.();
    this.cancelLoad = null;
    const database = this.database;
    this.ready = false;
    this.database = null;
    this.connection = null;
    this.worker?.terminate();
    this.worker = null;
    await database?.terminate();
  }
}
