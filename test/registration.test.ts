import { expect, it } from 'vitest';
import { AVA } from '@antv/ava/browser';
import { registerEngine } from '@antv/ava/engine';
import { DuckDBWasmEngine } from '../src/index';

it('requires explicit registration with the browser AVA instance', async () => {
  const ava = new AVA({ llm: { model: 'unused' }, engine: { type: 'duckdb-wasm' } });
  await expect(ava.source({ type: 'json', options: { data: [] } })).rejects.toThrow(
    'Engine type "duckdb-wasm" is not available'
  );
  registerEngine('duckdb-wasm', DuckDBWasmEngine);
  await expect(ava.source({ type: 'json', options: { data: [] } })).rejects.toThrow(
    'Browser DuckDB supports inline csv sources'
  );
});
