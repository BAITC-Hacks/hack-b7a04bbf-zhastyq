import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateParquetFile } from './importModel.ts';

// Minimal envelope for local checks; intentionally not a complete Parquet schema.
const envelope = () => {
  const bytes = new Uint8Array(16);
  bytes.set(new TextEncoder().encode('PAR1'));
  bytes.set(new TextEncoder().encode('PAR1'), 12);
  new DataView(bytes.buffer).setUint32(8, 4, true);
  return bytes;
};
test('local validation accepts a Parquet envelope without claiming schema validity', async () => {
  assert.equal(await validateParquetFile(new File([envelope()], 'nodes.PARQUET')), null);
});
test('wrong extension, empty files and renamed text are rejected', async () => {
  assert.match(await validateParquetFile(new File([envelope()], 'nodes.csv')), /\.parquet/);
  assert.match(await validateParquetFile(new File([], 'nodes.parquet')), /пуст/);
  assert.match(await validateParquetFile(new File(['not really parquet data'], 'nodes.parquet')), /распознать/);
});
test('truncated footer and invalid metadata bounds are rejected', async () => {
  assert.match(await validateParquetFile(new File(['PAR1'], 'edges.parquet')), /повреждён/);
  const bytes = envelope();
  new DataView(bytes.buffer).setUint32(8, 1000, true);
  assert.match(await validateParquetFile(new File([bytes], 'edges.parquet')), /длина метаданных/);
});
test('read errors become actionable messages', async () => {
  const unreadable = { name: 'nodes.parquet', size: 16, slice: () => ({ arrayBuffer: async () => { throw new Error('read failed'); } }) };
  assert.match(await validateParquetFile(unreadable), /прочитать/);
});
test('oversized file is rejected before reading or sending it', async () => {
  const oversized = { name: 'nodes.parquet', size: 25 * 1024 * 1024 + 1, slice: () => { throw new Error('must not read'); } };
  assert.match(await validateParquetFile(oversized), /25 МиБ/);
});
