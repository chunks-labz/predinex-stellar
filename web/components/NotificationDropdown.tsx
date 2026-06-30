'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, X, ExternalLink } from 'lucide-react';
import { useNotifications } from '@/app/lib/hooks/useNotifications';
import { NOTIFICATION_LABELS } from '@/app/lib/notifications-store';
import { useWallet } from '@/components/WalletAdapterProvider';

interface Props {
  open: boolean;
  onClose: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  claim_available: 'text-green-400',
  pool_settled: 'text-blue-400',
  pool_expiring_24h: 'text-yellow-400',
  dispute_filed: 'text-red-400',
};

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function NotificationDropdown({ open, onClose }: Props) {
  const { address } = useWallet();
  const { notifications, markRead, markAllRead, unreadCount } = useNotifications(address);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Notifications"
      className="absolute right-0 top-full mt-2 w-80 rounded-2xl border border-border bg-card shadow-xl z-50 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-semibold text-sm">Notifications</span>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
              aria-label="Mark all as read"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              All read
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close notifications"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* List */}
      <ul className="max-h-96 overflow-y-auto divide-y divide-border" role="list">
        {notifications.length === 0 ? (
          <li className="py-10 text-center text-sm text-muted-foreground">
            <Bell className="h-6 w-6 mx-auto mb-2 opacity-40" />
            No notifications yet
          </li>
        ) : (
          notifications.slice(0, 20).map((n) => (
            <li
              key={n.id}
              className={`flex gap-3 px-4 py-3 hover:bg-card/60 transition-colors ${n.read ? 'opacity-60' : ''}`}
            >
              {!n.read && (
                <span className="mt-1.5 h-2 w-2 rounded-full bg-primary flex-shrink-0" aria-hidden="true" />
              )}
              {n.read && <span className="mt-1.5 h-2 w-2 flex-shrink-0" aria-hidden="true" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs font-medium ${TYPE_COLORS[n.type] ?? 'text-muted-foreground'}`}>
                    {NOTIFICATION_LABELS[n.type]}
                  </span>
                  <span className="text-xs text-muted-foreground flex-shrink-0">{timeAgo(n.createdAt)}</span>
                </div>
                <p className="text-sm font-medium truncate">{n.title}</p>
                <p className="text-xs text-muted-foreground truncate">{n.body}</p>
                <div className="flex items-center gap-3 mt-1">
                  {n.poolId != null && (
                    <Link
                      href={`/pools/${n.poolId}`}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                      onClick={() => { markRead(n.id); onClose(); }}
                    >
                      View pool <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                  {!n.read && (
                    <button
                      type="button"
                      onClick={() => markRead(n.id)}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))
        )}
      </ul>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border">
        <Link
          href="/notifications"
          className="text-xs text-primary hover:underline"
          onClick={onClose}
        >
          View all notifications
        </Link>
      </div>
    </div>
  );
}
