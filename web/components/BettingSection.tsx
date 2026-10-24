import { useState } from 'react';
import type { Pool } from '@/app/lib/adapters/types';
import { TrendingUp, AlertCircle, Loader2 } from 'lucide-react';

export default function BettingSection({ pool, poolId }: { pool: Pool, poolId: number }) {
    const [selectedOutcome, setSelectedOutcome] = useState<'A' | 'B' | null>(null);
    const [amount, setAmount] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const totalVolume = pool.totalA + pool.totalB;
    const outcomeAPercent = totalVolume > 0 ? Math.round((pool.totalA / totalVolume) * 100) : 50;
    const outcomeBPercent = 100 - outcomeAPercent;

    // Calculate potential winnings
    const calculatePotentialReturn = () => {
        if (!amount || !selectedOutcome) return 0;
        const betAmount = parseFloat(amount);
        if (isNaN(betAmount) || betAmount <= 0) return 0;
        
        const selectedTotal = selectedOutcome === 'A' ? pool.totalA : pool.totalB;
        const otherTotal = selectedOutcome === 'A' ? pool.totalB : pool.totalA;
        const newTotal = totalVolume + betAmount;
        
        if (otherTotal === BigInt(0)) return betAmount * 2;
        return betAmount * (newTotal / (selectedTotal + betAmount));
    };

    const potentialReturn = calculatePotentialReturn();
    const potentialProfit = potentialReturn - parseFloat(amount || '0');

    return (
        <div className="bg-card/40 p-8 rounded-3xl border border-border backdrop-blur glass">
            <h3 className="text-2xl font-black mb-6 flex items-center gap-2">
                <TrendingUp className="h-6 w-6 text-primary" />
                Place Your Bet
            </h3>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
                <button
                    onClick={() => setSelectedOutcome('A')}
                    className={`p-6 rounded-2xl font-bold transition-all duration-300 relative overflow-hidden group ${
                        selectedOutcome === 'A' 
                            ? 'bg-primary text-white shadow-lg shadow-primary/30 scale-105' 
                            : 'bg-background hover:bg-muted hover:scale-102 border border-border'
                    }`}
                >
                    <div className="relative z-10">
                        <div className="text-lg mb-2">{pool.outcomeA}</div>
                        <div className="text-sm opacity-80">{outcomeAPercent}%</div>
                    </div>
                    {selectedOutcome === 'A' && (
                        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent" />
                    )}
                </button>
                <button
                    onClick={() => setSelectedOutcome('B')}
                    className={`p-6 rounded-2xl font-bold transition-all duration-300 relative overflow-hidden group ${
                        selectedOutcome === 'B' 
                            ? 'bg-accent text-white shadow-lg shadow-accent/30 scale-105' 
                            : 'bg-background hover:bg-muted hover:scale-102 border border-border'
                    }`}
                >
                    <div className="relative z-10">
                        <div className="text-lg mb-2">{pool.outcomeB}</div>
                        <div className="text-sm opacity-80">{outcomeBPercent}%</div>
                    </div>
                    {selectedOutcome === 'B' && (
                        <div className="absolute inset-0 bg-gradient-to-br from-accent/20 to-transparent" />
                    )}
                </button>
            </div>
            
            <div className="mb-6">
                <label className="block text-sm font-semibold mb-2 text-muted-foreground">
                    Bet Amount (XLM)
                </label>
                <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="Enter amount..."
                    className="w-full px-6 py-4 rounded-xl bg-background border-2 border-border outline-none focus:border-primary transition-colors text-lg font-semibold"
                    min="0"
                    step="0.1"
                />
            </div>

            {amount && selectedOutcome && parseFloat(amount) > 0 && (
                <div className="mb-6 p-4 rounded-xl bg-primary/5 border border-primary/20 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-muted-foreground">Potential Return</span>
                        <span className="text-lg font-bold text-primary">{potentialReturn.toFixed(2)} XLM</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Potential Profit</span>
                        <span className={`text-lg font-bold ${potentialProfit > 0 ? 'text-green-500' : 'text-muted-foreground'}`}>
                            +{potentialProfit.toFixed(2)} XLM
                        </span>
                    </div>
                </div>
            )}

            {!selectedOutcome && (
                <div className="mb-6 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5" />
                    <p className="text-sm text-amber-600 dark:text-amber-400">
                        Select an outcome to continue
                    </p>
                </div>
            )}
            
            <button 
                disabled={!selectedOutcome || !amount || isSubmitting || parseFloat(amount) <= 0}
                className="w-full py-5 bg-gradient-to-r from-primary to-accent rounded-xl font-bold text-white hover:opacity-90 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
            >
                {isSubmitting ? (
                    <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Placing Bet...
                    </>
                ) : (
                    'Place Bet'
                )}
            </button>
        </div>
    );
}
