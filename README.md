<div align="center">
  <h1>AVA Engine DuckDB-Wasm</h1>
  <p><strong>Bring SQL-powered visual analytics to the browser.</strong></p>
  <p>A browser-based DuckDB engine for <a href="https://github.com/antvis/AVA">AVA</a>.</p>
  <p><a href="https://www.npmjs.com/package/ava-engine-duckdb-wasm">npm</a> · <a href="https://ava-notebook.vercel.app/">Try AVA Notebook</a> · <a href="https://ava.antv.vision/documentation/">Documentation</a></p>
</div>

Load a CSV, query it with SQL, and explore it with AVA — all in your browser, with no analysis server required.

- 🦆 **DuckDB in the browser** — run SQL on inline CSV data with DuckDB-Wasm.
- 📊 **AVA-powered analysis** — discover schema, profile data, and turn questions into insights.
- ⚡ **Worker-based execution** — run queries off the main thread with time and result limits.

## 🚀 Get started

Install AVA and the engine:

```sh
npm install @antv/ava@beta ava-engine-duckdb-wasm
```

Register the engine once, then use AVA as usual:

```ts
import { AVA, registerEngine } from '@antv/ava/browser';
import { DuckDBWasmEngine } from 'ava-engine-duckdb-wasm';

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

## 🔎 Good to know

- **Data and privacy:** SQL runs locally in your browser. Natural-language analysis sends relevant context to your configured model provider.
- **DuckDB assets:** Loaded from jsDelivr by default; pass `engine.bundles` to host them yourself.
- **Data sources:** Inline CSV is supported. Browser memory and individual Arrow batch sizes limit large queries.

## License

[MIT](LICENSE)
