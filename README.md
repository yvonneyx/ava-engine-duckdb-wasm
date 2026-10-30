# ava-duckdb-wasm

DuckDB-Wasm browser engine for AVA. Requires an AVA build that exports `@antv/ava/engine`; the published AVA beta may not include that entry yet.

```ts
import { AVA } from '@antv/ava/browser';
import { registerEngine } from '@antv/ava/engine';
import { DuckDBWasmEngine } from 'ava-duckdb-wasm';

registerEngine('duckdb-wasm', DuckDBWasmEngine);
const ava = new AVA({ llm: { model: 'your-model' }, engine: { type: 'duckdb-wasm' } });
try {
  await ava.source({ type: 'csv', options: { csv: 'region,sales\nEast,3\nWest,7\n' } });
  console.log(await ava.query('SELECT region, sum(sales) AS sales FROM data GROUP BY region'));
} finally {
  await ava.dispose();
}
```

Supports inline CSV and runs SQL in a worker. Pass `engine.bundles` to serve DuckDB's Wasm and worker assets yourself. By default versioned jsDelivr assets are used. SQL execution has row, byte and time limits; the underlying Arrow stream may still contain large individual batches or fields.
