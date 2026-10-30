import { registerEngine } from '@antv/ava/engine';
import { DuckDBWasmEngine } from './engine';

registerEngine('duckdb-wasm', DuckDBWasmEngine);

export { DuckDBWasmEngine } from './engine';
export type { DuckDBWasmEngineOptions } from './engine';
