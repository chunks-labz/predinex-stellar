'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, FileJson, FileSpreadsheet, ChevronDown } from 'lucide-react';
import type { ActivityItem } from '../lib/stacks-api';
import {
  EXPORT_MAX_WINDOW_DAYS,
  type ExportFormat,
  activitiesToCSV,
  activitiesToJSON,
  buildExportFilename,
  filterActivitiesForExport,
  resolveExportWindow,
} from '../lib/activity-export';
import { useToast } from '../../providers/ToastProvider';

interface ActivityExportButtonProps {
  activities: ActivityItem[];
  /** `YYYY-MM-DD` date-range bounds shared with the page filters (optional). */
  fromDate?: string;
  toDate?: string;
  disabled?: boolean;
}

const MIME_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

/**
 * Exports the user's activity history as CSV or JSON. The export honours the
 * page's date-range filter and is bounded to a 90-day window; the user is
 * notified when their range is clamped or yields no rows.
 */
export default function ActivityExportButton({
  activities,
  fromDate = '',
  toDate = '',
  disabled = false,
}: ActivityExportButtonProps) {
  const { showToast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const triggerDownload = (content: string, filename: string, format: ExportFormat) => {
    const blob = new Blob([content], { type: MIME_TYPES[format] });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExport = (format: ExportFormat) => {
    setMenuOpen(false);

    const window = resolveExportWindow(fromDate, toDate);
    const scoped = filterActivitiesForExport(activities, window);

    if (scoped.length === 0) {
      showToast('No activity to export for the selected date range.', 'info');
      return;
    }

    const content = format === 'csv' ? activitiesToCSV(scoped) : activitiesToJSON(scoped);
    triggerDownload(content, buildExportFilename(format, window), format);

    if (window.clamped) {
      showToast(
        `Export limited to the most recent ${EXPORT_MAX_WINDOW_DAYS} days (${window.from} – ${window.to}).`,
        'warning'
      );
    } else {
      showToast(`Exported ${scoped.length} transaction${scoped.length === 1 ? '' : 's'} as ${format.toUpperCase()}.`, 'success');
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
        className="inline-flex items-center gap-2 rounded-xl border border-border bg-card/40 px-4 py-3 text-sm font-bold transition-colors hover:border-primary/40 hover:bg-card/60 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Download className="h-4 w-4" />
        Export
        <ChevronDown className={`h-4 w-4 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => handleExport('csv')}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/50"
          >
            <FileSpreadsheet className="h-4 w-4 text-green-500" />
            Export as CSV
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => handleExport('json')}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/50"
          >
            <FileJson className="h-4 w-4 text-amber-500" />
            Export as JSON
          </button>
        </div>
      )}
    </div>
  );
}
