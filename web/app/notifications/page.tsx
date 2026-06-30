'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, ChevronLeft, ExternalLink, Trash2 } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { useNotifications } from '@/app/lib/hooks/useNotifications';
import { clearAll, NOTIFICATION_LABELS } from '@/app/lib/notifications-store';
import { useWallet } from '@/components/WalletAdapterProvider';

const PAGE_SIZE = 20;

const TYPE_COLORS: Record<string, string> = {
  claim_available: 'text-green-400 bg-green-500/10 border-green-500/20',
  pool_settled: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  pool_expiring_24h: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  dispute_filed: 'text-red-400 bg-red-500/10 border-red-500/20',
};

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ms).toLocaleDateString();
}

export default function NotificationsPage() {
  const { address } = useWallet();
  const { notifications, markRead, markAllRead, unreadCount } = useNotifications(address);
  const [page, setPage] = useState(1);
  const [cleared, setCleared] = useState(false);

  const totalPages = Math.max(1, Math.ceil(notifications.length / PAGE_SIZE));
  const paged = notifications.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleClearAll = () => {
    clearAll(address);
    setCleared(true);
    // force re-render by using unreadCount — notifications hook will reload on next render via storage event
    window.dispatchEvent(new Event('storage'));
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Navbar />

      <div className="mx-auto max-w-3xl px-4 pb-16 pt-24 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex items-center gap-4">
          <Link
            href="/"
            className="p-2 hover:bg-muted/50 rounded-lg transition-colors"
            aria-label="Back to home"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1">
            <div className="inline-flex items-center gap-2 text-sm font-medium text-primary mb-1">
              <Bell className="h-4 w-4" />
              Notifications
            </div>
            <h1 className="text-3xl font-black tracking-tight">Notification History</h1>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card/40 px-3 py-2 text-sm font-medium hover:bg-card transition-colors"
              >
                <CheckCheck className="h-4 w-4" />
                Mark all read
              </button>
            )}
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card/40 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-red-400 hover:border-red-500/30 transition-colors"
                aria-label="Clear all notifications"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Summary */}
        {notifications.length > 0 && (
          <p className="mb-4 text-sm text-muted-foreground">
            {notifications.length} notification{notifications.length !== 1 ? 's' : ''}
            {unreadCount > 0 ? ` · ${unreadCount} unread` : ''}
          </p>
        )}

        {/* List */}
        {notifications.length === 0 || cleared ? (
          <div className="glass rounded-2xl border border-border p-12 text-center">
            <Bell className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-muted-foreground">No notifications yet.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Subscribe to pools to receive alerts on settlement, disputes, and claims.
            </p>
          </div>
        ) : (
          <ul className="space-y-2" role="list">
            {paged.map((n) => (
              <li
                key={n.id}
                className={`glass rounded-2xl border border-border p-4 transition-colors hover:bg-card/60 ${n.read ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start gap-3">
                  {!n.read && (
                    <span className="mt-1.5 h-2 w-2 rounded-full bg-primary flex-shrink-0" aria-hidden="true" />
                  )}
                  {n.read && <span className="mt-1.5 h-2 w-2 flex-shrink-0" aria-hidden="true" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[n.type] ?? 'text-muted-foreground bg-muted/30 border-border'}`}
                      >
                        {NOTIFICATION_LABELS[n.type]}
                      </span>
                      <span className="text-xs text-muted-foreground">{timeAgo(n.createdAt)}</span>
                    </div>
                    <p className="font-medium">{n.title}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">{n.body}</p>
                    <div className="flex items-center gap-4 mt-2">
                      {n.poolId != null && (
                        <Link
                          href={`/pools/${n.poolId}`}
                          onClick={() => markRead(n.id)}
                          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                        >
                          View pool <ExternalLink className="h-3 w-3" />
                        </Link>
                      )}
                      {!n.read && (
                        <button
                          type="button"
                          onClick={() => markRead(n.id)}
                          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Mark as read
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-xl border border-border bg-card/40 px-4 py-2 text-sm font-medium hover:bg-card disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-muted-foreground">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-xl border border-border bg-card/40 px-4 py-2 text-sm font-medium hover:bg-card disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
