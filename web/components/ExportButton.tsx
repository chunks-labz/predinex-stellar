'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';

type DatePreset = '7d' | '30d' | '90d' | 'custom';

interface ExportButtonProps {
  address: string;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function presetDates(preset: DatePreset): { from: string; to: string } {
  const to = toISODate(new Date());
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const from = toISODate(new Date(Date.now() - days * 86_400_000));
  return { from, to };
}

export default function ExportButton({ address }: ExportButtonProps) {
  const [preset, setPreset] = useState<DatePreset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setIsLoading(true);
    setError(null);
    try {
      const { from, to } =
        preset === 'custom'
          ? { from: customFrom, to: customTo }
          : presetDates(preset);

      const params = new URLSearchParams({ address, from, to });
      const res = await fetch(`/api/export/transactions?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? 'Export failed');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transactions_${from}_${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Date range preset selector */}
      <select
        value={preset}
        onChange={(e) => setPreset(e.target.value as DatePreset)}
        disabled={isLoading}
        aria-label="Date range"
        className="text-sm rounded-lg border border-border bg-card/40 px-3 py-2 text-foreground disabled:opacity-50"
      >
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="90d">Last 90 days</option>
        <option value="custom">Custom range</option>
      </select>

      {preset === 'custom' && (
        <>
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            disabled={isLoading}
            aria-label="From date"
            className="text-sm rounded-lg border border-border bg-card/40 px-3 py-2 text-foreground disabled:opacity-50"
          />
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            disabled={isLoading}
            aria-label="To date"
            className="text-sm rounded-lg border border-border bg-card/40 px-3 py-2 text-foreground disabled:opacity-50"
          />
        </>
      )}

      <button
        onClick={() => void handleExport()}
        disabled={isLoading || (preset === 'custom' && (!customFrom || !customTo))}
        aria-label="Export transactions as CSV"
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4" aria-hidden="true" />
        )}
        {isLoading ? 'Exporting…' : 'Export CSV'}
      </button>

      {error && (
        <p className="text-xs text-red-400" role="alert">{error}</p>
      )}
    </div>
  );
}
