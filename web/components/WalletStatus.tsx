'use client';

import { useWalletConnect } from '@/app/lib/hooks/useWalletConnect';
import { AlertCircle, CheckCircle, Clock, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

export function WalletStatus() {
  const { session } = useWalletConnect();
  const [isOnline, setIsOnline] = useState(true);

  // Derived directly from session — no extra state or effect needed
  const health = session?.isConnected ? { status: 'healthy', message: 'Connected' } : null;

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!session?.isConnected) {
    return null;
  }

  const getHealthIcon = () => {
    if (!isOnline) return <WifiOff className="w-4 h-4 text-red-500" />;

    switch (health?.status) {
      case 'healthy':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'warning':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'expired':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Wifi className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusText = () => {
    if (!isOnline) return 'Offline';
    return health?.message || 'Connected';
  };

  const getStatusColor = () => {
    if (!isOnline) return 'text-red-500';

    switch (health?.status) {
      case 'healthy':
        return 'text-green-500';
      case 'warning':
        return 'text-yellow-500';
      case 'expired':
        return 'text-red-500';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      {getHealthIcon()}
      <span className={getStatusColor()}>
        {getStatusText()}
      </span>
    </div>
  );
}// Component to display current Stacks connection status
// Component to display current Stacks connection status
