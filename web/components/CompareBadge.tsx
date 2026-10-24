'use client';

import Link from 'next/link';
import { BarChart2 } from 'lucide-react';
import { usePoolComparison, POOL_COMPARISON_MAX } from '@/app/lib/hooks/usePoolComparison';

export default function CompareBadge() {
  const { count } = usePoolComparison();

  if (count === 0) return null;

  return (
    <Link
      href="/compare"
      aria-label={`Compare ${count} selected pool${count === 1 ? '' : 's'}`}
      className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:brightness-110 transition-all animate-in fade-in slide-in-from-bottom-2"
    >
      <BarChart2 className="w-5 h-5" aria-hidden="true" />
      <span className="font-semibold text-sm">
        Compare ({count}/{POOL_COMPARISON_MAX})
      </span>
    </Link>
  );
}
