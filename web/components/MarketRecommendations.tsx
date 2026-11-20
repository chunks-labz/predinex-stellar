/**
 * MarketRecommendations Component
 * Issue #1532: UX Iteration 2 - Personalized recommendations
 */
'use client';
import { Sparkles, TrendingUp } from 'lucide-react';
import Link from 'next/link';

interface Market {
  id: number;
  title: string;
  volume: string;
  oddsA: number;
}

interface MarketRecommendationsProps {
  markets: Market[];
  reason: string;
}

export function MarketRecommendations({ markets, reason }: MarketRecommendationsProps) {
  return (
    <div className="glass p-6 rounded-xl">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-bold">Recommended For You</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{reason}</p>
      <div className="space-y-3">
        {markets.map((market) => (
          <Link key={market.id} href={`/markets/${market.id}`} className="block p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
            <h4 className="font-medium mb-2 line-clamp-2">{market.title}</h4>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" />{market.volume}</span>
              <span>{market.oddsA}% odds</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
