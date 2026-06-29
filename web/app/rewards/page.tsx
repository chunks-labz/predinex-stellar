'use client';

import Navbar from '@/components/Navbar';
import AuthGuard from '@/components/AuthGuard';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "../../components/ui/accordion";
import { Info, Trophy } from "lucide-react";
import RouteErrorBoundary from '../../components/RouteErrorBoundary';
import Leaderboard from "../../components/Leaderboard";
import { useWallet } from '@/components/WalletAdapterProvider';
import { useLeaderboard } from "../lib/hooks/useLeaderboard";
import { TOKEN_SYMBOL } from "@/lib/formatting";

export default function RewardsPage() {
  const { address: stxAddress } = useWallet();

  const { userRank, entries } = useLeaderboard(stxAddress);

  const totalParticipants = entries.length;
  const topPercent =
    userRank && totalParticipants > 0
      ? Math.ceil((userRank / totalParticipants) * 100)
      : null;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Navbar />
      <RouteErrorBoundary routeName="Rewards">
      <AuthGuard>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 pb-12 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="glass-panel p-8 rounded-2xl mb-8">
            <h1 className="text-4xl font-extrabold mb-2 bg-linear-to-r from-primary to-purple-400 bg-clip-text text-transparent">
              Rewards
            </h1>
            <p className="text-muted-foreground">Monitor your performance, rank, and earnings</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
            <div className="lg:col-span-2">
              <Leaderboard currentUserAddress={stxAddress} />
            </div>
            <div className="lg:col-span-1">
              <div className="glass-panel p-6 rounded-xl h-full flex flex-col justify-center items-center text-center">
                {userRank ? (
                  <>
                    <h2 className="text-lg font-medium text-muted-foreground mb-2">Your Rank</h2>
                    <div className="text-5xl font-extrabold text-primary mb-2">#{userRank}</div>
                    {topPercent !== null && (
                      <p className="text-sm text-muted-foreground">
                        Top {topPercent}% of contributors
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <Trophy className="h-10 w-10 text-muted-foreground mb-3 opacity-40" />
                    <h2 className="text-lg font-medium text-muted-foreground mb-1">Not ranked yet</h2>
                    <p className="text-sm text-muted-foreground">
                      Place a bet or create a pool to appear on the leaderboard.
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="mt-8">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="calculation" className="border-border">
                <AccordionTrigger className="text-lg font-semibold">
                  <div className="flex items-center gap-2">
                    <Info className="h-5 w-5 text-primary" />
                    How is ranking calculated?
                  </div>
                </AccordionTrigger>
                <AccordionContent className="text-base text-muted-foreground space-y-4">
                  <p>
                    Rankings are based on your total net profits (winnings - wagered). The more
                    profitable your predictions, the higher you rank.
                  </p>
                  <ul className="list-disc pl-6 space-y-2 mt-2">
                    <li>Total predictions made</li>
                    <li>Win percentage (correct predictions / total predictions)</li>
                    <li>Total profits (net winnings minus total wagered)</li>
                    <li>Current streak (consecutive pools won)</li>
                  </ul>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </div>
      </AuthGuard>
      </RouteErrorBoundary>
    </main>
  );
}
