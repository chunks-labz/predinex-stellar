'use client';

import { useState } from 'react';

const CHAINS = [
    { id: 'all', label: 'All Chains', icon: '🌐' },
    { id: 'stellar', label: 'Stellar', icon: '⭐' },
    { id: 'ethereum', label: 'Ethereum', icon: '🔷' },
    { id: 'polygon', label: 'Polygon', icon: '🟣' },
    { id: 'arbitrum', label: 'Arbitrum', icon: '🔵' },
    { id: 'solana', label: 'Solana', icon: '🟢' },
] as const;

export type ChainFilter = (typeof CHAINS)[number]['id'];

interface CrossChainFilterProps {
    selected: ChainFilter;
    onSelect: (chain: ChainFilter) => void;
}

export default function CrossChainFilter({ selected, onSelect }: CrossChainFilterProps) {
    return (
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1" role="radiogroup" aria-label="Filter pools by chain">
            {CHAINS.map((chain) => (
                <button
                    key={chain.id}
                    type="button"
                    role="radio"
                    aria-checked={selected === chain.id}
                    onClick={() => onSelect(chain.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap border transition-colors ${
                        selected === chain.id
                            ? 'bg-primary/15 border-primary/40 text-primary'
                            : 'bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    }`}
                >
                    <span aria-hidden="true">{chain.icon}</span>
                    {chain.label}
                </button>
            ))}
        </div>
    );
}

export function useCrossChainFilter() {
    const [selectedChain, setSelectedChain] = useState<ChainFilter>('all');
    return { selectedChain, setSelectedChain };
}
