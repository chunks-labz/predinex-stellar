'use client';

import { Trophy, TrendingUp, PieChart, Percent, Info } from 'lucide-react';
import { Pool } from '@/app/lib/market-types';
import { formatPayout, formatPayoutMultiplier, stroopsToUnits } from '@/app/lib/formatting';
import { useI18n } from '@/app/lib/i18n';
import Tooltip from '@/components/ui/Tooltip';

const PROTOCOL_FEE_BPS = 200; // 2% — matches contract

interface SettledPoolSummaryProps {
    pool: Pool;
}

export default function SettledPoolSummary({ pool }: SettledPoolSummaryProps) {
    const { t } = useI18n();

    if (!pool.settled) return null;

    const winningOutcome = pool.winningOutcome === 0 ? pool.outcomeA : pool.outcomeB;
    const losingOutcome = pool.winningOutcome === 0 ? pool.outcomeB : pool.outcomeA;
    const winningSideTotal = pool.winningOutcome === 0 ? pool.totalA : pool.totalB;
    const losingSideTotal = pool.winningOutcome === 0 ? pool.totalB : pool.totalA;
    const totalPool = pool.totalA + pool.totalB;

    const protocolFee = Math.floor(totalPool * PROTOCOL_FEE_BPS / 10_000);
    const netPayout = totalPool - protocolFee;

    const payoutMultiplier = winningSideTotal > 0
        ? (netPayout / winningSideTotal)
        : 0;

    return (
        <div className="mb-8 space-y-4">
            {/* Winning Outcome Banner */}
            <div className="bg-gradient-to-r from-green-500/10 via-green-500/5 to-transparent border border-green-500/20 rounded-xl p-5">
                <div className="flex items-center gap-3 mb-1">
                    <Trophy className="w-6 h-6 text-green-400" />
                    <span className="text-xs font-medium uppercase tracking-wider text-green-400">
                        Winning Outcome
                    </span>
                </div>
                <p className="text-2xl font-bold text-green-300">{winningOutcome}</p>
                <p className="text-sm text-muted-foreground mt-1">
                    {losingOutcome} did not win this market.
                </p>
            </div>

            {/* Payout Breakdown */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                    <TrendingUp className="w-4 h-4 mx-auto mb-1.5 text-primary" />
                    <p className="text-xs text-muted-foreground">Total Pool</p>
                    <p className="text-sm font-bold">{formatPayout(stroopsToUnits(totalPool))}</p>
                </div>

                <div className="bg-muted/50 rounded-lg p-3 text-center">
                    <PieChart className="w-4 h-4 mx-auto mb-1.5 text-green-400" />
                    <p className="text-xs text-muted-foreground">Winning Side</p>
                    <p className="text-sm font-bold">{formatPayout(stroopsToUnits(winningSideTotal))}</p>
                </div>

                <div className="bg-muted/50 rounded-lg p-3 text-center">
                    <PieChart className="w-4 h-4 mx-auto mb-1.5 text-red-400" />
                    <p className="text-xs text-muted-foreground">Losing Side</p>
                    <p className="text-sm font-bold">{formatPayout(stroopsToUnits(losingSideTotal))}</p>
                </div>

                <div className="bg-muted/50 rounded-lg p-3 text-center">
                    <Tooltip content={t('betting.sharesPayoutInfo')}>
                        <button
                            type="button"
                            aria-label={t('betting.sharesPayoutInfoLabel')}
                            className="inline-flex items-center gap-1 text-yellow-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                        >
                            <Percent className="w-4 h-4" />
                            <Info className="w-3 h-3" aria-hidden="true" />
                        </button>
                    </Tooltip>
                    <p className="text-xs text-muted-foreground">Payout Multiple</p>
                    <p className="text-sm font-bold">{formatPayoutMultiplier(payoutMultiplier)}</p>
                </div>
            </div>

            {/* Fee Notice */}
            <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/30 rounded-lg px-4 py-2.5">
                <span>Protocol fee ({PROTOCOL_FEE_BPS / 100}%)</span>
                <span>{formatPayout(stroopsToUnits(protocolFee))}</span>
            </div>
            <div className="flex items-center justify-between text-sm font-medium bg-muted/30 rounded-lg px-4 py-2.5">
                <span>Net payout pool</span>
                <span>{formatPayout(stroopsToUnits(netPayout))}</span>
            </div>
        </div>
    );
}
