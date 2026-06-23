'use client';

import dynamic from 'next/dynamic';
import Navbar from '../components/Navbar';

function DisputeManagementSkeleton() {
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="h-16 bg-card/20 animate-pulse rounded-xl border border-border/50" />
      <div className="h-12 bg-card/20 animate-pulse rounded-lg border border-border/50" />
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 bg-card/20 animate-pulse rounded-xl border border-border/50" />
        ))}
      </div>
    </div>
  );
}

const DisputeManagement = dynamic(() => import('../components/DisputeManagement'), {
  loading: () => <DisputeManagementSkeleton />,
});

export default function DisputesPage() {
  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      <DisputeManagement />
    </main>
  );
}
