import type { DataSourceConfig, ExecutionResult } from '@antv/ava/browser';

export type {
  DataModel, DataSourceConfig, ExecutionOptions, ExecutionResult, LLMConfig,
  LogicalType, Metric, MetricConfig, MetricId, ParsedProfileOptions, Profile, ProfileOptions,
  Properties, Schema,
} from '@antv/ava/browser';

export type QueryColumn = ExecutionResult['schema'][number];
export type CSVReadOptions = Extract<DataSourceConfig, { type: 'csv' }>['options']['options'];
export interface DuckDBConnection {
  run(sql: string): Promise<unknown>;
  runAndReadAll(sql: string): Promise<{ getRowObjectsJson(): Record<string, unknown>[] }>;
}
