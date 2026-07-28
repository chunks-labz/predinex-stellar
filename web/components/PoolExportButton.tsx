'use client';

/**
 * #722 — Export dropdown for pool data (CSV/JSON).
 * Calls /api/export/pool/:id with format + optional participants flag.
 */
import { useEffect, useRef, useState } from 'react';
import { Download, FileJson, FileSpreadsheet, ChevronDown, Loader2 } from 'lucide-react';
import { poolToCSV, poolToJSON, buildPoolExportFilename } from '@/app/lib/activity-export';
import type { ExportFormat } from '@/app/lib/activity-export';

type PoolLike = {
  id?: number;
  title?: string;
  description?: string;
  outcomeA?: string;
  outcomeB?: string;
  totalA?: number;
  totalB?: number;
  settled?: boolean;
  status?: string;
  creator?: string;
  expiry?: number;
  participant_count?: number;
};

interface PoolExportButtonProps {
  pool: PoolLike;
  poolId: number;
  /** Show "Include participants" option (only for pool creator). */
  isCreator?: boolean;
  walletAddress?: string | null;
}

const MIME: Record<ExportFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

function triggerDownload(content: string, filename: string, format: ExportFormat) {
  const blob = new Blob([content], { type: MIME[format] });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function PoolExportButton({ pool, poolId, isCreator = false, walletAddress }: PoolExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleExport = (format: ExportFormat, participants = false) => {
    setOpen(false);
    setError(null);
    setLoading(true);
    try {
      // Client-side export using pool data already in memory.
      const filename = buildPoolExportFilename(poolId, format);
      const content = format === 'csv' ? poolToCSV(pool, poolId) : poolToJSON(pool, poolId);
      triggerDownload(content, filename, format);
    } catch {
      setError('Export failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleParticipantsExport = async (format: ExportFormat) => {
    setOpen(false);
    setError(null);
    setLoading(true);
    try {
      const params = new URLSearchParams({
        format,
        participants: 'true',
        ...(walletAddress ? { address: walletAddress } : {}),
      });
      const res = await fetch(`/api/export/pool/${poolId}?${params}`);
      if (res.status === 429) {
        setError('Rate limit reached. Max 10 exports per hour.');
        return;
      }
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const date = new Date().toISOString().slice(0, 10);
      const filename = `predinex-pool-${poolId}-participants-${date}.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setError('Export failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={loading}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-2 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-card/60 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        Export
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          <button type="button" role="menuitem" onClick={() => handleExport('csv')}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-muted/50">
            <FileSpreadsheet className="h-4 w-4 text-green-500" />Pool data (CSV)
          </button>
          <button type="button" role="menuitem" onClick={() => handleExport('json')}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-muted/50">
            <FileJson className="h-4 w-4 text-amber-500" />Pool data (JSON)
          </button>
          {isCreator && (
            <>
              <div className="border-t border-border/50" />
              <button type="button" role="menuitem" onClick={() => handleParticipantsExport('csv')}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-muted/50">
                <FileSpreadsheet className="h-4 w-4 text-blue-500" />Participants (CSV)
              </button>
              <button type="button" role="menuitem" onClick={() => handleParticipantsExport('json')}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-muted/50">
                <FileJson className="h-4 w-4 text-purple-500" />Participants (JSON)
              </button>
            </>
          )}
        </div>
      )}

      {error && <p className="mt-1 text-xs text-red-400" role="alert">{error}</p>}
    </div>
  );
}
