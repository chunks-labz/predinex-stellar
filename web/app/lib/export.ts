'use client';

export type ExportFormat = 'csv' | 'json';
export type ExportRecord = Record<string, string | number | boolean | null | undefined>;

function escapeCsvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function serializeToCsv(records: ExportRecord[]): string {
  if (records.length === 0) return '';

  const headers = Array.from(
    records.reduce((set, record) => {
      Object.keys(record).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );

  const rows = records.map((record) =>
    headers
      .map((header) => {
        const cell = record[header];
        if (cell === undefined || cell === null) return '';
        return escapeCsvCell(String(cell));
      })
      .join(','),
  );

  return [headers.join(','), ...rows].join('\n');
}

export function downloadTextFile(filename: string, contents: string, mimeType: string): void {
  if (typeof window === 'undefined') return;

  const blob = new Blob([contents], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

export function buildExportFilename(baseName: string, format: ExportFormat): string {
  const suffix = format === 'csv' ? 'csv' : 'json';
  return `${baseName}-${new Date().toISOString().replace(/[:.]/g, '-')}.${suffix}`;
}

export function exportRecords(
  records: ExportRecord[],
  baseName: string,
  format: ExportFormat,
): void {
  const filename = buildExportFilename(baseName, format);
  if (format === 'csv') {
    downloadTextFile(filename, serializeToCsv(records), 'text/csv;charset=utf-8');
    return;
  }

  downloadTextFile(filename, JSON.stringify(records, null, 2), 'application/json;charset=utf-8');
}
