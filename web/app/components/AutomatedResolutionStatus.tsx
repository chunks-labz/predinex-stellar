"use client";

import { useState, useEffect } from 'react';
import { formatDisplayAddress } from '../lib/address-display';
import {
  mockPools,
  mockConfigs,
  mockAttempts,
  mockFallbacks,
  type Pool,
  type ResolutionConfig,
  type ResolutionAttempt,
  type FallbackStatus,
} from '../lib/fixtures/automatedResolution';
import { useSettlePool } from '../lib/hooks/useSettlePool';
import { TransactionFeeModal } from '@/components/TransactionFeeModal';

export default function AutomatedResolutionStatus() {
  const [pools, setPools] = useState<Pool[]>([]);
  const [resolutionConfigs, setResolutionConfigs] = useState<ResolutionConfig[]>([]);
  const [resolutionAttempts, setResolutionAttempts] = useState<ResolutionAttempt[]>([]);
  const [fallbackStatuses, setFallbackStatuses] = useState<FallbackStatus[]>([]);
  const [selectedTab, setSelectedTab] = useState<'automated' | 'pending' | 'fallback'>('automated');

  const { settle, feePrompt, setFeePrompt, stage, setStage } = useSettlePool();

  // Effect-managed clock so render output is derived from state, not direct Date.now() calls
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Load mock data from fixtures
  useEffect(() => {
    // Defer state updates to avoid synchronous setState-in-effect lint warning
    const timer = setTimeout(() => {
      setPools(mockPools);
      setResolutionConfigs(mockConfigs);
      setResolutionAttempts(mockAttempts);
      setFallbackStatuses(mockFallbacks);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const formatSTX = (microSTX: number) => {
    return (microSTX / 1000000).toFixed(2);
  };

  const formatTimeRemaining = (expiry: number) => {
    const remaining = expiry - now;
    
    if (remaining <= 0) return 'Expired';
    
    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const getPoolConfig = (poolId: number) => {
    return resolutionConfigs.find(config => config.poolId === poolId);
  };

  const getPoolAttempts = (poolId: number) => {
    return resolutionAttempts.filter(attempt => attempt.poolId === poolId);
  };

  const getFallbackStatus = (poolId: number) => {
    return fallbackStatuses.find(status => status.poolId === poolId);
  };

  const renderAutomatedPools = () => {
    const automatedPools = pools.filter(pool => {
      const config = getPoolConfig(pool.id);
      return config && config.isAutomated;
    });

    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-xl font-semibold">Automated Resolution Pools</h3>
          <div className="text-sm text-muted-foreground">
            {automatedPools.length} pools configured
          </div>
        </div>
        
        <div className="space-y-4">
          {automatedPools.map((pool) => {
            const config = getPoolConfig(pool.id);
            const attempts = getPoolAttempts(pool.id);
            
            return (
              <div key={pool.id} className="glass p-6 rounded-xl">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-mono text-sm">Pool #{pool.id}</span>
                      <span className={`px-2 py-1 rounded text-xs ${
                        pool.settled 
                          ? 'bg-green-500/10 text-green-500' 
                          : pool.expiry < now
                          ? 'bg-red-500/10 text-red-500'
                          : 'bg-blue-500/10 text-blue-500'
                      }`}>
                        {pool.settled ? 'Resolved' : pool.expiry < now ? 'Expired' : 'Active'}
                      </span>
                    </div>
                    <h4 className="font-semibold text-lg mb-1">{pool.title}</h4>
                    <div className="text-sm text-muted-foreground">
                      Total Pool: {formatSTX(pool.totalA + pool.totalB)} STX
                    </div>
                  </div>
                  
                  <div className="text-right">
                    <div className="text-sm font-semibold">
                      {pool.settled ? 'Automated' : formatTimeRemaining(pool.expiry)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {pool.settled ? 'Resolution' : 'Time Remaining'}
                    </div>
                  </div>
                </div>
                
                {config && (
                  <div className="mb-4 p-3 bg-muted rounded-lg">
                    <div className="text-sm font-medium mb-2">Resolution Configuration</div>
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <span className="text-muted-foreground">Criteria:</span> {config.resolutionCriteria}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Type:</span> {config.criteriaType}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Oracles:</span> {config.oracleSources.length} sources
                      </div>
                      <div>
                        <span className="text-muted-foreground">Operator:</span> {config.logicalOperator}
                      </div>
                    </div>
                  </div>
                )}
                
                {attempts.length > 0 && (
                  <div className="mb-4">
                    <div className="text-sm font-medium mb-2">Resolution Attempts ({attempts.length})</div>
                    <div className="space-y-2">
                      {attempts.map((attempt) => (
                        <div key={attempt.attemptId} className="flex justify-between items-center text-xs p-2 bg-muted rounded">
                          <div>
                            <span className="font-mono">Attempt #{attempt.attemptId}</span>
                            {attempt.isSuccessful ? (
                              <span className="ml-2 text-green-500">✓ Success</span>
                            ) : (
                              <span className="ml-2 text-red-500">✗ Failed</span>
                            )}
                          </div>
                          <div className="text-muted-foreground">
                            {new Date(attempt.attemptedAt).toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {pool.settled && pool.winningOutcome !== undefined && (
                  <div className="flex items-center justify-between p-3 bg-green-500/10 rounded-lg">
                    <div className="text-sm">
                      <span className="font-medium">Resolved:</span> {pool.winningOutcome === 0 ? pool.outcomeA : pool.outcomeB}
                    </div>
                    <div className="text-xs text-green-500">
                      Automated Resolution ✓
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderPendingResolution = () => {
    const pendingPools = pools.filter(pool => {
      const config = getPoolConfig(pool.id);
      return config && config.isAutomated && !pool.settled && pool.expiry < now;
    });

    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-xl font-semibold">Pending Resolution</h3>
          <div className="text-sm text-muted-foreground">
            {pendingPools.length} pools awaiting resolution
          </div>
        </div>
        
        {pendingPools.length === 0 ? (
          <div className="glass p-8 rounded-xl text-center">
            <div className="text-muted-foreground">No pools pending resolution</div>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingPools.map((pool) => {
              const config = getPoolConfig(pool.id);
              const attempts = getPoolAttempts(pool.id);
              
              return (
                <div key={pool.id} className="glass p-6 rounded-xl border-orange-500/20">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-mono text-sm">Pool #{pool.id}</span>
                        <span className="px-2 py-1 bg-orange-500/10 text-orange-500 rounded text-xs">
                          Pending Resolution
                        </span>
                      </div>
                      <h4 className="font-semibold text-lg mb-1">{pool.title}</h4>
                      <div className="text-sm text-muted-foreground">
                        Expired {formatTimeRemaining(pool.expiry)} ago
                      </div>
                    </div>
                    
                    <button className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm hover:bg-primary/90">
                      Trigger Resolution
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <div className="text-sm text-muted-foreground">Pool Value</div>
                      <div className="font-semibold">{formatSTX(pool.totalA + pool.totalB)} STX</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Attempts</div>
                      <div className="font-semibold">{attempts.length}/{config?.retryAttempts || 3}</div>
                    </div>
                  </div>
                  
                  {attempts.length > 0 && (
                    <div className="text-sm text-muted-foreground">
                      Last attempt: {attempts[attempts.length - 1].failureReason || 'Unknown error'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderFallbackPools = () => {
    const fallbackPools = pools.filter(pool => getFallbackStatus(pool.id));

    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-xl font-semibold">Fallback Resolution</h3>
          <div className="text-sm text-muted-foreground">
            {fallbackPools.length} pools in fallback mode
          </div>
        </div>
        
        {fallbackPools.length === 0 ? (
          <div className="glass p-8 rounded-xl text-center">
            <div className="text-muted-foreground">No pools in fallback mode</div>
          </div>
        ) : (
          <div className="space-y-4">
            {fallbackPools.map((pool) => {
              const fallback = getFallbackStatus(pool.id);
              
              return (
                <div key={pool.id} className="glass p-6 rounded-xl border-red-500/20">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-mono text-sm">Pool #{pool.id}</span>
                        <span className="px-2 py-1 bg-red-500/10 text-red-500 rounded text-xs">
                          Fallback Mode
                        </span>
                      </div>
                      <h4 className="font-semibold text-lg mb-1">{pool.title}</h4>
                      <div className="text-sm text-muted-foreground">
                        Creator: {formatDisplayAddress(pool.creator)}
                      </div>
                    </div>
                    
                    {fallback?.manualSettlementEnabled && (
                      <button
                        onClick={() => settle(pool.id, 0)} // defaulting to outcome 0 for mock purposes
                        className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600"
                      >
                        Manual Settlement
                      </button>
                    )}
                  </div>
                  
                  {fallback && (
                    <div className="p-3 bg-red-500/10 rounded-lg mb-4">
                      <div className="text-sm font-medium text-red-500 mb-1">Fallback Reason</div>
                      <div className="text-sm">{fallback.failureReason}</div>
                    </div>
                  )}
                  
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">Max Retries</div>
                      <div className={fallback?.maxRetriesReached ? 'text-red-500' : 'text-green-500'}>
                        {fallback?.maxRetriesReached ? 'Reached' : 'Not Reached'}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Manual Settlement</div>
                      <div className={fallback?.manualSettlementEnabled ? 'text-green-500' : 'text-red-500'}>
                        {fallback?.manualSettlementEnabled ? 'Enabled' : 'Disabled'}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Creator Notified</div>
                      <div className={fallback?.notifiedCreator ? 'text-green-500' : 'text-yellow-500'}>
                        {fallback?.notifiedCreator ? 'Yes' : 'Pending'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <TransactionFeeModal
        isOpen={!!feePrompt}
        actionName="Manual Settlement"
        feeStroops={feePrompt?.feeStroops || '0'}
        onConfirm={() => {
            feePrompt?.resolve(true);
            setFeePrompt(null);
        }}
        onCancel={() => {
            feePrompt?.resolve(false);
            setFeePrompt(null);
            setStage('idle');
        }}
        isConfirming={stage === 'signing' || stage === 'submitting' || stage === 'polling'}
      />

      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Automated Resolution Status</h1>
        <p className="text-muted-foreground">
          Monitor automated market resolution progress and manage fallback scenarios
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex space-x-1 mb-6 bg-muted p-1 rounded-lg">
        {[
          { key: 'automated' as const, label: 'Automated Pools' },
          { key: 'pending' as const, label: 'Pending Resolution' },
          { key: 'fallback' as const, label: 'Fallback Mode' }
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSelectedTab(tab.key)}
            className={`flex-1 px-4 py-2 rounded-md transition-colors ${
              selectedTab === tab.key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {selectedTab === 'automated' && renderAutomatedPools()}
        {selectedTab === 'pending' && renderPendingResolution()}
        {selectedTab === 'fallback' && renderFallbackPools()}
      </div>
    </div>
  );
}