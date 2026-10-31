import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { TIMEZONE_DHAKA } from '@dokanos/shared';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatBDT(amount: number): string {
  const formatted = new Intl.NumberFormat('en-BD', {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `৳${formatted}`;
}

export function formatDateDhaka(dateInput: string | Date): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: TIMEZONE_DHAKA,
  }).format(date);
}

export type CsvCellValue = string | number | boolean | null | undefined;

export function escapeCsvCell(value: CsvCellValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  const raw = String(value);
  // Prevent spreadsheet formula injection on non-numeric strings starting with =, +, -, @
  const safe =
    typeof value === 'string' &&
    /^[=+\-@]/.test(raw) &&
    Number.isNaN(Number(raw))
      ? `'${raw}`
      : raw;

  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function downloadCsvFile(
  filename: string,
  headers: string[],
  rows: CsvCellValue[][],
): void {
  const csvLines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ];
  // Prepend UTF-8 BOM (\uFEFF) so Excel and accounting suites read UTF-8 symbols properly
  const csvContent = `\uFEFF${csvLines.join('\r\n')}\r\n`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

