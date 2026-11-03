import { afterEach, expect, it, vi } from 'vitest';

import { DuckDBWasmEngine } from '../src/engine';

const database = vi.hoisted(() => ({
  instantiate: vi.fn(async () => {}),
  open: vi.fn(async () => {}),
  connect: vi.fn(async () => ({ query: async () => ({ toArray: () => [] }) })),
  registerFileText: vi.fn(async () => {}),
  terminate: vi.fn(async () => {}),
}));
vi.mock('@duckdb/duckdb-wasm', () => ({
  AsyncDuckDB: class { constructor() { return database; } },
  VoidLogger: class {},
  getJsDelivrBundles: vi.fn(),
  selectBundle: async (bundles: any) => bundles.mvp,
}));
afterEach(() => vi.unstubAllGlobals());

it('loads Wasm when the worker cannot consume a downloaded response as a Blob', async () => {
  const bytes = new Uint8Array([0, 97, 115, 109]);
  const response = new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } });
  vi.spyOn(response, 'blob').mockRejectedValue(new TypeError('Failed to fetch'));
  const fetch = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('location', new URL('https://notebook.test/assets/analysis.worker.js'));
  vi.stubGlobal('Worker', class extends EventTarget { terminate() {} });
  const createObjectURL = vi.spyOn(URL, 'createObjectURL');
  const engine = new DuckDBWasmEngine({ model: 'unused' }, {
    bundles: { mvp: { mainModule: 'https://notebook.test/engine.wasm', mainWorker: 'https://notebook.test/engine.worker.js' } },
  });
  try {
    await engine.load({ type: 'csv', options: { csv: 'n\n1\n' } });
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe('application/wasm');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(database.instantiate).toHaveBeenCalledWith(expect.stringMatching(/^blob:/));
  } finally {
    await engine.dispose();
    vi.restoreAllMocks();
  }
});
