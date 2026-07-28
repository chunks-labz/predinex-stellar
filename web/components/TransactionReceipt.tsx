'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Clock, ExternalLink, Copy, Check } from 'lucide-react';
import { formatCurrency } from '../lib/dashboard-utils';

export interface TransactionReceiptData {
  txId: string;
  network: string;
  ledgerSequence?: number;
  ledgerTimestamp?: number;
  marketId?: number;
  marketTitle?: string;
  type: 'create' | 'bet' | 'claim' | 'settle' | 'cancel' | 'void';
  amount?: number;
  outcome?: string;
  status: 'pending' | 'success' | 'failed';
  error?: string;
  timestamp: number;
}

interface TransactionReceiptProps {
  receipt: TransactionReceiptData;
  onClose?: () => void;
  onRefresh?: () => void;
  isOpen: boolean;
}

const NETWORK_EXPLORERS: Record<string, string> = {
  'mainnet': 'https://stellar.expert/explorer/public',
  'testnet': 'https://stellar.expert/explorer/testnet',
  'futurenet': 'https://stellar.expert/explorer/futurenet',
  'sandbox': 'https://stellar.expert/explorer/sandbox',
};

export default function TransactionReceipt({ receipt, onClose, onRefresh, isOpen }: TransactionReceiptProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  if (!isOpen) return null;

  const explorerBase = NETWORK_EXPLORERS[receipt.network] || NETWORK_EXPLORERS['testnet'];
  const txUrl = `${explorerBase}/tx/${receipt.txId}`;
  const ledgerUrl = receipt.ledgerSequence
    ? `${explorerBase}/ledger/${receipt.ledgerSequence}`
    : undefined;

  const copyTxId = async () => {
    await navigator.clipboard.writeText(receipt.txId);
    setCopied(true);
  };

  const typeLabels: Record<TransactionReceiptData['type'], string> = {
    create: 'Market Created',
    bet: 'Bet Placed',
    claim: 'Winnings Claimed',
    settle: 'Market Settled',
    cancel: 'Market Cancelled',
    void: 'Market Voided',
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="glass max-w-md w-full rounded-xl overflow-hidden">
        {/* Header */}
        <div className={`p-6 ${
          receipt.status === 'success' ? 'bg-green-500/10' :
          receipt.status === 'failed' ? 'bg-red-500/10' :
          'bg-blue-500/10'
        }`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Transaction Receipt</h3>
            {onClose && (
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                <XCircle className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Status Icon */}
          <div className="flex justify-center mb-4">
            {receipt.status === 'success' && (
              <CheckCircle className="w-16 h-16 text-green-500" />
            )}
            {receipt.status === 'failed' && (
              <XCircle className="w-16 h-16 text-red-500" />
            )}
            {receipt.status === 'pending' && (
              <Clock className="w-16 h-16 text-blue-500 animate-pulse" />
            )}
          </div>

          <div className="text-center">
            <div className={`text-lg font-bold ${
              receipt.status === 'success' ? 'text-green-500' :
              receipt.status === 'failed' ? 'text-red-500' :
              'text-blue-500'
            }`}>
              {typeLabels[receipt.type]}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {receipt.status === 'success' && 'Transaction successful'}
              {receipt.status === 'failed' && 'Transaction failed'}
              {receipt.status === 'pending' && 'Transaction pending...'}
            </div>
          </div>
        </div>

        {/* Receipt Details */}
        <div className="p-6 space-y-4">
          {/* Transaction ID */}
          <div>
            <div className="text-xs text-muted-foreground mb-1">Transaction ID</div>
            <div className="flex items-center gap-2">
              <code className="text-xs bg-muted/50 px-2 py-1 rounded flex-1 truncate">
                {receipt.txId}
              </code>
              <button
                onClick={copyTxId}
                className="p-1 hover:bg-muted/50 rounded transition-colors"
                title="Copy transaction ID"
              >
                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </button>
              <a
                href={txUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 hover:bg-muted/50 rounded transition-colors"
                title="View on explorer"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Network */}
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Network</span>
            <span className="text-sm font-medium">{receipt.network}</span>
          </div>

          {/* Ledger Context */}
          {receipt.ledgerSequence && (
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Ledger</span>
              <div className="flex items-center gap-1">
                <span className="text-sm font-medium">{receipt.ledgerSequence.toLocaleString()}</span>
                {ledgerUrl && (
                  <a href={ledgerUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-3 h-3 text-muted-foreground" />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Timestamp */}
          {receipt.ledgerTimestamp && (
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Ledger Time</span>
              <span className="text-sm font-medium">
                {new Date(receipt.ledgerTimestamp * 1000).toLocaleString()}
              </span>
            </div>
          )}

          {/* Market Details */}
          {receipt.marketId && (
            <div className="pt-3 border-t border-muted/30">
              <div className="text-xs text-muted-foreground mb-2">Market Details</div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Market ID</span>
                <span className="text-sm font-medium">#{receipt.marketId}</span>
              </div>
              {receipt.marketTitle && (
                <div className="flex justify-between mt-1">
                  <span className="text-sm text-muted-foreground">Title</span>
                  <span className="text-sm font-medium text-right max-w-[200px] truncate">
                    {receipt.marketTitle}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Amount */}
          {receipt.amount !== undefined && (
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">
                {receipt.type === 'bet' ? 'Bet Amount' : 'Claim Amount'}
              </span>
              <span className="text-sm font-medium">{formatCurrency(receipt.amount)}</span>
            </div>
          )}

          {/* Outcome */}
          {receipt.outcome && (
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Outcome</span>
              <span className="text-sm font-medium">{receipt.outcome}</span>
            </div>
          )}

          {/* Error Message */}
          {receipt.status === 'failed' && receipt.error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <div className="text-sm text-red-500">{receipt.error}</div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-6 pt-0 flex gap-3">
          {onRefresh && receipt.status === 'pending' && (
            <button
              onClick={onRefresh}
              className="flex-1 px-4 py-2 border border-muted/50 rounded-lg hover:bg-muted/50 transition-colors text-sm font-medium"
            >
              Refresh Status
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
