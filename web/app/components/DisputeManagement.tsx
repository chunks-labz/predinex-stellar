'use client';

import dynamic from 'next/dynamic';
import { useWallet } from './WalletAdapterProvider';
import { useDisputeManagement } from '../lib/disputes/useDisputeManagement';
import { EmptyState } from '../../components/EmptyState';
import { DisconnectedState } from '../../components/DisconnectedState';
import { DisputePageHeader } from './disputes/DisputePageHeader';
import { DisputeTabNav } from './disputes/DisputeTabNav';
import { ActiveDisputesSection } from './disputes/ActiveDisputesSection';

function TabPanelSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="h-32 bg-card/20 animate-pulse rounded-xl border border-border/50" />
      ))}
    </div>
  );
}

const ResolvedDisputesSection = dynamic(
  () => import('./disputes/ResolvedDisputesSection').then((m) => ({ default: m.ResolvedDisputesSection })),
  { loading: () => <TabPanelSkeleton /> },
);

const CreateDisputeSection = dynamic(
  () => import('./disputes/CreateDisputeSection').then((m) => ({ default: m.CreateDisputeSection })),
  { loading: () => <TabPanelSkeleton /> },
);

export default function DisputeManagement() {
  const { address, isConnected } = useWallet();
  const { disputes, selectedTab, setSelectedTab, isLoading, now, hasUserVoted, getUserVote, handleVote } =
    useDisputeManagement(address);

  if (!isConnected) {
    return <DisconnectedState />;
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <DisputePageHeader />
      <DisputeTabNav selected={selectedTab} onSelect={setSelectedTab} />
      <div>
        {selectedTab === 'active' && (
          <ActiveDisputesSection
            disputes={disputes}
            now={now}
            isLoading={isLoading}
            hasUserVoted={hasUserVoted}
            getUserVote={getUserVote}
            onVote={handleVote}
          />
        )}
        {selectedTab === 'resolved' && disputes.length === 0 ? (
          <EmptyState message="No resolved disputes yet" />
        ) : (
          <ResolvedDisputesSection disputes={disputes} />
        )}
        {selectedTab === 'create' && <CreateDisputeSection isLoading={isLoading} />}
      </div>
    </div>
  );
}
