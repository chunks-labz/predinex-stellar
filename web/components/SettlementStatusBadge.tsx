import { CheckCircle, Clock, AlertTriangle } from 'lucide-react';

interface SettlementStatusBadgeProps {
  status: 'settled' | 'disputed';
  payoutStatus?: 'paid' | 'pending';
  className?: string;
}

export default function SettlementStatusBadge({
  status,
  payoutStatus = 'pending',
  className = '',
}: SettlementStatusBadgeProps) {
  if (status === 'disputed') {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400 ${className}`}>
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        Disputed
      </span>
    );
  }

  const paid = payoutStatus === 'paid';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${
      paid
        ? 'bg-green-500/10 text-green-700 dark:text-green-400'
        : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
    } ${className}`}>
      {paid
        ? <CheckCircle className="h-3 w-3" aria-hidden="true" />
        : <Clock className="h-3 w-3" aria-hidden="true" />}
      {paid ? 'Paid' : 'Settlement pending'}
    </span>
  );
}
