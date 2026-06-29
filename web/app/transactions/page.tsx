'use client';

import { useState } from 'react';
import { ArrowUpRight, ArrowDownLeft, Shield } from 'lucide-react';
import RouteErrorBoundary from '../../components/RouteErrorBoundary';
import { ICON_CLASS } from '../lib/constants';
import { exportRecords } from '../lib/export';

interface Transaction {
  id: string;
  type: 'pool_created' | 'bet_placed' | 'settlement' | 'payout_claimed' | 'deposit' | 'withdrawal';
  description: string;
  amount: number;
  date: Date;
  status: 'completed' | 'pending' | 'failed';
  hash?: string;
}

// Mock data - replace with actual API calls
const mockTransactions: Transaction[] = [
  {
    id: '1',
    type: 'pool_created',
    description: 'Created prediction pool: Will Bitcoin reach $100k?',
    amount: 0,
    date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    status: 'completed',
    hash: '0x1234...5678',
  },
  {
    id: '2',
    type: 'bet_placed',
    description: 'Bet placed on: Tech stocks Q2 2026',
    amount: 50,
    date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    status: 'completed',
    hash: '0xabcd...efgh',
  },
  {
    id: '3',
    type: 'settlement',
    description: 'Pool settled: Will Bitcoin reach $100k?',
    amount: 0,
    date: new Date(Date.now() - 12 * 60 * 60 * 1000),
    status: 'completed',
    hash: '0x5678...1234',
  },
  {
    id: '4',
    type: 'payout_claimed',
    description: 'Payout claimed from settled pool',
    amount: 125.50,
    date: new Date(Date.now() - 6 * 60 * 60 * 1000),
    status: 'completed',
    hash: '0xijkl...mnop',
  },
];

type FilterType = 'all' | 'pool_created' | 'bet_placed' | 'settlement' | 'payout_claimed';

export default function TransactionsPage() {
  const [filter, setFilter] = useState<FilterType>('all');
  const [dateRange, setDateRange] = useState<'all' | 'week' | 'month' | 'year'>('all');

  const filteredTransactions = mockTransactions.filter((tx) => {
    if (filter !== 'all' && tx.type !== filter) return false;

    const now = new Date();
    const txDate = new Date(tx.date);

    switch (dateRange) {
      case 'week':
        return now.getTime() - txDate.getTime() <= 7 * 24 * 60 * 60 * 1000;
      case 'month':
        return now.getTime() - txDate.getTime() <= 30 * 24 * 60 * 60 * 1000;
      case 'year':
        return now.getTime() - txDate.getTime() <= 365 * 24 * 60 * 60 * 1000;
      default:
        return true;
    }
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'bet_placed':
        return <ArrowUpRight className={`${ICON_CLASS.sm} text-red-500`} />;
      case 'payout_claimed':
        return <ArrowDownLeft className={`${ICON_CLASS.sm} text-green-500`} />;
      default:
        return <Shield className={`${ICON_CLASS.sm} text-blue-500`} />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500/10 text-green-500';
      case 'pending':
        return 'bg-yellow-500/10 text-yellow-500';
      case 'failed':
        return 'bg-red-500/10 text-red-500';
      default:
        return 'bg-gray-500/10 text-gray-500';
    }
  };

  const transactionExportRows = filteredTransactions.map((tx) => ({
    id: tx.id,
    type: tx.type,
    description: tx.description,
    amount: tx.amount,
    date: tx.date.toISOString(),
    status: tx.status,
    hash: tx.hash ?? '',
  }));

  return (
    <main className="min-h-screen pt-24 pb-16 px-4">
      <RouteErrorBoundary routeName="Transactions">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
          <h1 className="text-4xl font-bold mb-2">Transaction History</h1>
          <p className="text-muted-foreground">View all your pool creations, bets, settlements, and payouts</p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => exportRecords(transactionExportRows, 'predinex-transactions', 'csv')}
              className="rounded-xl border border-border bg-card/40 px-4 py-3 text-sm font-semibold transition-colors hover:bg-card"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => exportRecords(transactionExportRows, 'predinex-transactions', 'json')}
              className="rounded-xl border border-border bg-card/40 px-4 py-3 text-sm font-semibold transition-colors hover:bg-card"
            >
              Export JSON
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="glass-panel p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Transaction Type Filter */}
            <div>
              <label className="block text-sm font-medium mb-3">Transaction Type</label>
              <div className="space-y-2">
                {(['all', 'pool_created', 'bet_placed', 'settlement', 'payout_claimed'] as FilterType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setFilter(type)}
                    className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
                      filter === type
                        ? 'bg-primary/20 text-primary border border-primary/50'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                  >
                    {type === 'all' ? 'All Types' : type.replace(/_/g, ' ').charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>

            {/* Date Range Filter */}
            <div>
              <label className="block text-sm font-medium mb-3">Date Range</label>
              <div className="grid grid-cols-2 gap-2">
                {(['all', 'week', 'month', 'year'] as const).map((range) => (
                  <button
                    key={range}
                    onClick={() => setDateRange(range)}
                    className={`px-4 py-2 rounded-lg transition-colors text-sm font-medium ${
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
        </div>

        {/* Transactions List */}
        <div className="space-y-4">
          {filteredTransactions.length === 0 ? (
            <div className="glass-panel p-12 text-center">
              <p className="text-muted-foreground">No transactions found for the selected filters</p>
            </div>
          ) : (
            filteredTransactions.map((tx) => (
              <div key={tx.id} className="glass-panel p-6 hover:shadow-lg transition-all">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-muted/50 rounded-lg">{getTypeIcon(tx.type)}</div>
                    <div className="flex-1">
                      <h3 className="font-semibold mb-1">{tx.description}</h3>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span>{new Date(tx.date).toLocaleDateString()}</span>
                        {tx.hash && (
                          <a href={`#${tx.hash}`} className="hover:text-primary transition-colors">
                            {tx.hash}
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    {tx.amount !== 0 && (
                      <div className={`text-lg font-semibold mb-2 ${tx.type === 'bet_placed' ? 'text-red-500' : 'text-green-500'}`}>
                        {tx.type === 'bet_placed' ? '-' : '+'}
                        {Math.abs(tx.amount).toFixed(2)} XLM
                      </div>
                    )}
                    <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(tx.status)}`}>
                      {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      </RouteErrorBoundary>
    </main>
  );
}
