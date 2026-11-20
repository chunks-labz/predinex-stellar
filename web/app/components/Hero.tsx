import { ArrowRight, Trophy, Sparkles } from "lucide-react";
import Link from "next/link";

export default function Hero() {
    return (
        <div className="relative pt-32 pb-20 sm:pt-40 sm:pb-32 overflow-hidden">
            {/* Soft background glows */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full max-w-7xl opacity-30 pointer-events-none">
                <div className="absolute top-0 left-[10%] w-[500px] h-[500px] bg-primary/20 rounded-full blur-[140px] animate-float" />
                <div className="absolute bottom-0 right-[10%] w-[600px] h-[600px] bg-accent/10 rounded-full blur-[160px] animate-float-delayed" />
            </div>

            <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/20 bg-primary/5 text-xs font-bold text-primary mb-10 tracking-widest uppercase animate-pulse">
                    <Sparkles size={14} />
                    Live on Stellar Testnet
                </div>

                <h1 className="text-6xl md:text-8xl font-black tracking-tighter mb-8 leading-[0.9]">
                    PREDICT THE <span className="gradient-text inline-block">FUTURE</span>.
                    <br />
                    WIN ON <span className="text-foreground">STELLAR</span>.
                </h1>

                <p className="max-w-2xl mx-auto text-lg md:text-xl text-muted-foreground mb-12 leading-relaxed font-medium">
                    The institutional-grade prediction market built for the Stellar ecosystem.
                    Scalable, trustless, and powered by Soroban smart contracts.
                </p>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
                    <Link
                        href="/markets"
                        className="btn-primary flex items-center gap-3 group"
                    >
                        EXPLORE MARKETS
                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </Link>
                    <Link
                        href="/create"
                        className="glass-panel px-10 py-5 flex items-center gap-3 active:scale-95"
                    >
                        <Trophy className="w-5 h-5 text-accent" />
                        CREATE POOL
                    </Link>
                </div>
            </div>
        </div>
    );
}
