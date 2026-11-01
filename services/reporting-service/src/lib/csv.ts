export interface DailySnapshotCsvRow {
  day: string;
  currency: string;
  succeededCount: number;
  failedCount: number;
  refundedCount: number;
  grossVolumeMinor: string;
  refundedVolumeMinor: string;
}

const COLUMNS: Array<keyof DailySnapshotCsvRow> = [
  "day",
  "currency",
  "succeededCount",
  "failedCount",
  "refundedCount",
  "grossVolumeMinor",
  "refundedVolumeMinor"
];

export function csvCell(value: string | number): string {
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(rows: DailySnapshotCsvRow[]): string {
  const lines = [COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(COLUMNS.map((column) => csvCell(row[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}
