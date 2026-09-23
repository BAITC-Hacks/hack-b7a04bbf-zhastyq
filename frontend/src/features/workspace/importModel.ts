export const importKeys = ['edges', 'nodes', 'transactions'] as const;
export type ImportKey = typeof importKeys[number];
export type SlotStatus = 'empty' | 'validating' | 'selected' | 'uploading' | 'checking' | 'ready' | 'error';
export type ImportSlotState = { status: SlotStatus; file?: File; error?: string; progress?: number; revision: number };
export type ImportSlots = Record<ImportKey, ImportSlotState>;
export type PipelineStatus = 'idle' | 'uploading' | 'checking' | 'running' | 'complete' | 'error';
export type ImportEvent =
  | { type: 'file'; key: ImportKey; status: 'uploading' | 'checking' | 'ready' | 'error'; progress?: number; error?: string }
  | { type: 'pipeline'; status: Exclude<PipelineStatus, 'idle'>; error?: string };

/** API adapter reports confirmed states; the UI never simulates completion. */
export type StartImport = (files: Record<ImportKey, File>, report: (event: ImportEvent) => void, signal: AbortSignal) => Promise<void>;
export const emptySlots = (): ImportSlots => ({ edges: { status: 'empty', revision: 0 }, nodes: { status: 'empty', revision: 0 }, transactions: { status: 'empty', revision: 0 } });

/** Lightweight envelope check only; column/type validation belongs to the service. */
export async function validateParquetFile(file: File): Promise<string | null> {
  if (!/\.parquet$/i.test(file.name)) return 'Ожидается файл .parquet.';
  if (!file.size) return 'Файл пуст. Выберите выгрузку с данными.';
  if (file.size > 25 * 1024 * 1024) return 'Файл превышает лимит сервиса: 25 МиБ на один файл.';
  if (file.size < 12) return 'Файл повреждён: отсутствует заголовок Parquet.';
  try {
    const [start, end] = await Promise.all([file.slice(0, 4).arrayBuffer(), file.slice(-8).arrayBuffer()]);
    const decode = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);
    if (decode(start) !== 'PAR1' || decode(end.slice(4)) !== 'PAR1') return 'Не удалось распознать Parquet. Файл повреждён или использует неподдерживаемое шифрование.';
    const footerLength = new DataView(end).getUint32(0, true);
    if (!footerLength || footerLength > file.size - 12) return 'Файл повреждён: неверная длина метаданных Parquet.';
    return null;
  } catch {
    return 'Не удалось прочитать файл. Выберите его повторно.';
  }
}
