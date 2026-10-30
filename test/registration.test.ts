import { expect, it } from 'vitest';
import { AVA } from '@antv/ava/browser';
import '../src/index';

it('registers the extension with the browser AVA instance', async () => {
  const ava = new AVA({ llm: { model: 'unused' }, engine: { type: 'duckdb-wasm' } });
  await expect(ava.source({ type: 'json', options: { data: [] } })).rejects.toThrow(
    'Browser DuckDB supports inline csv sources'
  );
});
