import { expect, it, vi } from 'vitest';

import { DuckDBWasmEngine } from '../src/engine';

function engineWithRows(rows: Array<Record<string, unknown>>) {
  const visited = vi.fn();
  const closed = vi.fn();
  const statement = {
    send: async () => ({
      async *[Symbol.asyncIterator]() {
        for (const row of rows) {
          visited();
          yield [row];
        }
      },
    }),
    close: closed,
  };
  const engine = new DuckDBWasmEngine({ model: 'unused' });
  Object.assign(engine, {
    ready: true,
    connection: {
      prepare: async (sql: string) =>
        sql.startsWith('DESCRIBE')
          ? {
              query: async () => ({ toArray: () => [{ column_name: 'value', column_type: 'VARCHAR' }] }),
              close: vi.fn(),
            }
          : statement,
    },
  });
  return { engine, visited, closed };
}

it('stops reading streamed results when the byte limit is reached', async () => {
  const { engine, visited, closed } = engineWithRows([{ value: 'one' }, { value: 'two' }, { value: 'three' }]);
  const result = await engine.execute('SELECT value FROM data', { maxResultBytes: 15 });
  expect(result.data).toEqual([{ value: 'one' }]);
  expect(result.truncatedBy).toBe('maxResultBytes');
  expect(visited).toHaveBeenCalledTimes(2);
  expect(closed).toHaveBeenCalledOnce();
});

it('preserves row limits and closes the statement when a field is too large', async () => {
  const limited = engineWithRows([{ value: 'one' }, { value: 'two' }, { value: 'three' }]);
  const result = await limited.engine.execute('SELECT value FROM data', { maxRows: 1 });
  expect(result.data).toEqual([{ value: 'one' }]);
  expect(result.truncatedBy).toBe('maxRows');
  expect(limited.visited).toHaveBeenCalledTimes(2);
  expect(limited.closed).toHaveBeenCalledOnce();

  const oversized = engineWithRows([{ value: 'x'.repeat(1024 * 1024) }]);
  await expect(oversized.engine.execute('SELECT value FROM data')).rejects.toThrow('Result field exceeds the 1 MiB limit');
  expect(oversized.closed).toHaveBeenCalledOnce();
});
