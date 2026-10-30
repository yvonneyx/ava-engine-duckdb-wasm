<div align="center">
  <h1>AVA DuckDB-Wasm</h1>
  <p><strong>Bring SQL-powered visual analytics to the browser.</strong></p>
  <p>A DuckDB-Wasm engine for <a href="https://github.com/antvis/AVA">AVA</a>.</p>
  <p><a href="https://ava-notebook.vercel.app/">Try AVA Notebook</a> · <a href="https://ava.antv.vision/documentation/">AVA documentation</a></p>
</div>

Load a CSV, explore it with SQL, and use AVA to turn questions into analysis and visualizations. DuckDB runs in a browser worker, so your application can analyze data without an analysis server.

## At a glance

- **Browser SQL** — query inline CSV with DuckDB-Wasm.
- **AVA workflows** — discover schema, profile data, and analyze questions.
- **Worker execution** — keep queries off the main thread, with time and result limits.

## Get started

Register the engine once, then use AVA as usual:

```ts
import { AVA } from '@antv/ava/browser';
import { registerEngine } from '@antv/ava/engine';
import { DuckDBWasmEngine } from 'ava-duckdb-wasm';

registerEngine('duckdb-wasm', DuckDBWasmEngine);

const ava = new AVA({
  llm: { model: 'your-model' },
  engine: { type: 'duckdb-wasm' },
});

try {
  await ava.source({ type: 'csv', options: { csv: 'region,sales\nEast,3\nWest,7\n' } });
  const result = await ava.query('SELECT region, SUM(sales) AS sales FROM data GROUP BY region');
  console.log(result.data);
} finally {
  await ava.dispose();
}
```

> **Availability:** This package is not yet published to npm. It requires an AVA build that exports `@antv/ava/engine`; the published AVA beta may not include that entry yet.

## Good to know

- SQL runs locally. Natural-language analysis sends relevant context to your configured model provider.
- DuckDB assets load from jsDelivr by default; pass `engine.bundles` to host them yourself.
- The current engine supports inline CSV. Browser memory and individual Arrow batch sizes still limit large queries.

## License

[MIT](LICENSE)
