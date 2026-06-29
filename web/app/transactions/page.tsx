'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowUpRight,
  ArrowDownLeft,
  Shield,
  RefreshCw,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
  Filter,
  History,
} from 'lucide-react';
import RouteErrorBoundary from '../../components/RouteErrorBoundary';
import Card from '../../components/ui/Card';
import { ICON_CLASS } from '../lib/constants';
import { exportRecords } from '../lib/export';

interface Transaction {
  id: string;
  type: 'pool_created' | 'bet_placed' | 'settlement' | 'payout_claimed' | 'cancel' | 'refund';
  description: string;
  poolName?: string;
  amount: number;
  date: string;
  status: 'pending' | 'confirmed' | 'failed';
  hash?: string;
  error?: string;
  retryAction?: () => void;
}

const STORAGE_KEY = 'predinex-tx-history';
const ITEMS_PER_PAGE = 10;

const STELLAR_EXPLORER_BASE = 'https://stellar.expert/explorer/testnet/tx';

function loadTransactions(): Transaction[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveTransactions(txs: Transaction[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(txs));
  } catch {
    // localStorage full or unavailable
  }
}

export function addTransaction(tx: Transaction) {
  const existing = loadTransactions();
  const updated = [tx, ...existing].slice(0, 500);
  saveTransactions(updated);
}

export function updateTransactionStatus(id: string, status: Transaction['status'], hash?: string, error?: string) {
  const existing = loadTransactions();
  const updated = existing.map((tx) =>
    tx.id === id ? { ...tx, status, hash: hash ?? tx.hash, error: error ?? tx.error } : tx
  );
  saveTransactions(updated);
}

type FilterType = 'all' | 'pool_created' | 'bet_placed' | 'settlement' | 'payout_claimed' | 'cancel' | 'refund';
type StatusFilter = 'all' | 'pending' | 'confirmed' | 'failed';
type DateRange = 'all' | 'week' | 'month' | 'year';

function TransactionsContent() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filter, setFilter] = useState<FilterType>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setTransactions(loadTransactions());
  }, []);

  const filtered = transactions.filter((tx) => {
    if (filter !== 'all' && tx.type !== filter) return false;
    if (statusFilter !== 'all' && tx.status !== statusFilter) return false;

    if (dateRange !== 'all') {
      const now = Date.now();
      const txTime = new Date(tx.date).getTime();
      const ranges: Record<string, number> = {
        week: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000,
        year: 365 * 24 * 60 * 60 * 1000,
      };
      if (now - txTime > ranges[dateRange]) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  useEffect(() => {
    setPage(1);
  }, [filter, statusFilter, dateRange]);

  const handleRetry = useCallback((tx: Transaction) => {
    if (tx.retryAction) {
      updateTransactionStatus(tx.id, 'pending');
      setTransactions(loadTransactions());
      tx.retryAction();
    }
  }, []);

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'bet_placed':
        return <ArrowUpRight className={`${ICON_CLASS.sm} text-red-500`} />;
      case 'payout_claimed':
        return <ArrowDownLeft className={`${ICON_CLASS.sm} text-green-500`} />;
      case 'cancel':
      case 'refund':
        return <RefreshCw className={`${ICON_CLASS.sm} text-yellow-500`} />;
      default:
        return <Shield className={`${ICON_CLASS.sm} text-blue-500`} />;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed':
        return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'pending':
        return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
      case 'failed':
        return 'bg-red-500/10 text-red-500 border-red-500/20';
      default:
        return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
    }
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      pool_created: 'Pool Created',
      bet_placed: 'Bet Placed',
      settlement: 'Settlement',
      payout_claimed: 'Payout Claimed',
      cancel: 'Cancelled',
      refund: 'Refund',
    };
    return labels[type] || type;
  };

  const transactionExportRows = filtered.map((tx) => ({
    id: tx.id,
    type: tx.type,
    description: tx.description,
    poolName: tx.poolName ?? '',
    amount: tx.amount,
    date: tx.date,
    status: tx.status,
    hash: tx.hash ?? '',
  }));

  const pendingCount = transactions.filter((tx) => tx.status === 'pending').length;
  const failedCount = transactions.filter((tx) => tx.status === 'failed').length;

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-4xl font-black mb-2 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Transaction History
            </h1>
            <p className="text-muted-foreground">
              View all your pool creations, bets, settlements, and payouts
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => exportRecords(transactionExportRows, 'predinex-transactions', 'csv')}
              className="rounded-xl border border-border bg-card/40 px-4 py-2 text-sm font-semibold transition-colors hover:bg-card"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => exportRecords(transactionExportRows, 'predinex-transactions', 'json')}
              className="rounded-xl border border-border bg-card/40 px-4 py-2 text-sm font-semibold transition-colors hover:bg-card"
            >
              Export JSON
            </button>
          </div>
        </div>

        {/* Status summary */}
        {(pendingCount > 0 || failedCount > 0) && (
          <div className="flex gap-4 mb-6">
            {pendingCount > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-sm">
                <Clock className="w-4 h-4" />
                {pendingCount} pending
              </div>
            )}
            {failedCount > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
                <XCircle className="w-4 h-4" />
                {failedCount} failed
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        <Card className="p-6 mb-8 bg-card/40 backdrop-blur-md border-border/50">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Filters</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Transaction Type Filter */}
            <div>
              <label className="block text-sm font-medium mb-3 text-muted-foreground">Type</label>
              <div className="space-y-1">
                {(['all', 'pool_created', 'bet_placed', 'settlement', 'payout_claimed', 'cancel', 'refund'] as FilterType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setFilter(type)}
                    className={`w-full text-left px-3 py-1.5 rounded-lg transition-colors text-sm ${
                      filter === type
                        ? 'bg-primary/20 text-primary border border-primary/50'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                  >
                    {type === 'all' ? 'All Types' : getTypeLabel(type)}
                  </button>
                ))}
              </div>
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-sm font-medium mb-3 text-muted-foreground">Status</label>
              <div className="space-y-1">
                {(['all', 'pending', 'confirmed', 'failed'] as StatusFilter[]).map((status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`w-full text-left px-3 py-1.5 rounded-lg transition-colors text-sm ${
                      statusFilter === status
                        ? 'bg-primary/20 text-primary border border-primary/50'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                  >
                    {status === 'all' ? 'All Statuses' : status.charAt(0).toUpperCase() + status.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Date Range Filter */}
            <div>
              <label className="block text-sm font-medium mb-3 text-muted-foreground">Date Range</label>
              <div className="grid grid-cols-2 gap-2">
                {(['all', 'week', 'month', 'year'] as const).map((range) => (
                  <button
                    key={range}
                    onClick={() => setDateRange(range)}
                    className={`px-3 py-1.5 rounded-lg transition-colors text-sm font-medium ${
                      dateRange === range
                        ? 'bg-primary/20 text-primary border border-primary/50'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                  >
                    {range === 'all' ? 'All Time' : range.charAt(0).toUpperCase() + range.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Transactions List */}
        <div className="space-y-3">
          {paginated.length === 0 ? (
            <Card className="p-12 text-center bg-card/40 backdrop-blur-md border-border/50">
              <History className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Transactions Found</h3>
              <p className="text-muted-foreground">
                {transactions.length === 0
                  ? 'Your transaction history will appear here once you interact with the protocol.'
                  : 'No transactions match your current filters.'}
              </p>
            </Card>
          ) : (
            paginated.map((tx) => (
              <Card key={tx.id} className="p-5 bg-card/40 backdrop-blur-md border-border/50 hover:border-primary/30 transition-all">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="p-3 bg-muted/50 rounded-lg shrink-0">
                      {getTypeIcon(tx.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold truncate">{tx.description}</h3>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(tx.status)}`}>
                          {getStatusIcon(tx.status)}
                          {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                        <span>{new Date(tx.date).toLocaleString()}</span>
                        {tx.poolName && (
                          <span className="text-primary/70">Pool: {tx.poolName}</span>
                        )}
                        {tx.hash && (
                          <a
                            href={`${STELLAR_EXPLORER_BASE}/${tx.hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 hover:text-primary transition-colors"
                          >
                            {tx.hash.slice(0, 8)}...{tx.hash.slice(-4)}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        {tx.error && (
                          <span className="text-red-400 text-xs">{tx.error}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {tx.amount !== 0 && (
                      <div className={`text-lg font-semibold ${tx.type === 'bet_placed' ? 'text-red-500' : 'text-green-500'}`}>
                        {tx.type === 'bet_placed' ? '-' : '+'}
                        {Math.abs(tx.amount).toFixed(2)} XLM
                      </div>
                    )}
                    {tx.status === 'failed' && tx.retryAction && (
                      <button
                        type="button"
                        onClick={() => handleRetry(tx)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-8">
            <p className="text-sm text-muted-foreground">
              Showing {((page - 1) * ITEMS_PER_PAGE) + 1}–{Math.min(page * ITEMS_PER_PAGE, filtered.length)} of {filtered.length}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2 rounded-lg border border-border hover:bg-card transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pageNum = page <= 3 ? i + 1 : page + i - 2;
                if (pageNum < 1 || pageNum > totalPages) return null;
                return (
                  <button
                    key={pageNum}
                    type="button"
                    onClick={() => setPage(pageNum)}
                    className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                      pageNum === page
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-card text-muted-foreground'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-2 rounded-lg border border-border hover:bg-card transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function TransactionsPage() {
  return (
    <RouteErrorBoundary routeName="Transactions">
      <TransactionsContent />
    </RouteErrorBoundary>
  );
}
