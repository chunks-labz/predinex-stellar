'use client';

import { useState } from "react";
import Link from "next/link";
import { LogOut, Menu, X, Wallet } from "lucide-react";
import { useWallet } from './WalletAdapterProvider';
import { ICON_CLASS } from "../lib/constants";
import { WalletAddressCopyButton } from "../../components/WalletAddressCopyButton";
import { NetworkMismatchWarning } from './NetworkMismatchWarning';

export default function Navbar() {
    const { isConnected, address, connect, disconnect } = useWallet();
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    return (
        <div className="fixed top-0 w-full z-50 flex flex-col">
            <NetworkMismatchWarning />
            <nav aria-label="Main navigation" className="w-full glass-panel !rounded-none !border-x-0 !border-t-0 border-b border-white/10 shadow-lg">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-16">
                        {/* Logo */}
                        <Link href="/" className="flex items-center gap-2 group" aria-label="Predinex Home">
                            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">
                                <span className="font-bold text-white">P</span>
                            </div>
                            <span className="font-bold text-xl tracking-tight text-gradient">Predinex</span>
                        </Link>
                        {/* Navigation Links - Desktop */}
                        <div className="hidden md:flex items-center gap-6" aria-label="Desktop navigation">
                            <Link href="/markets" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors" aria-label="View all markets">
                                Markets
                            </Link>
                            <Link href="/create" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors" aria-label="Create a new prediction market">
                                Create
                            </Link>
                            {isConnected && (
                                <Link href="/activity" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors" aria-label="View activity feed">
                                    Activity
                                </Link>
                            )}
                            {isConnected && (
                                <Link href="/dashboard" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors" aria-label="User dashboard">
                                    Dashboard
                                </Link>
                            )}
                        </div>

                    {/* User Info & Connect Button - Desktop */}
                    <div className="hidden md:flex items-center gap-4">
                        {isConnected && address ? (
                            <div className="flex items-center gap-3">
                                <WalletAddressCopyButton address={address} />
                                <button
                                    onClick={disconnect}
                                    className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-full border border-red-500/20 transition-all hover:scale-110 active:scale-95"
                                    aria-label="Sign out"
                                    title="Sign out"
                                >
                                    <LogOut className={ICON_CLASS.sm} />
                                </button>
                            </div>
                        ) : (
                            <>
                            <button
                                onClick={connect}
                                className="flex items-center gap-2 bg-primary/10 hover:bg-primary/20 text-primary px-3 py-2 rounded-full border border-primary/20 transition-colors font-medium text-sm"
                                aria-label="Connect wallet"
                            >
                                <Wallet className={ICON_CLASS.sm + " text-primary"} />
                            </button>
                            <button
                                onClick={() => setIsMenuOpen(!isMenuOpen)}
                                className="p-2 text-muted-foreground hover:text-foreground transition-colors"
                                aria-expanded={isMenuOpen}
                                aria-label={isMenuOpen ? "Close menu" : "Open menu"}
                            >
                                {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
                            </button>
                            </>
                        )}
                    </div>
                </div>
            </div>

                {/* Mobile Menu Backdrop */}
                {isMenuOpen && (
                    <div
                        className="fixed inset-0 bg-black/60 backdrop-blur-md z-[-1] md:hidden animate-in fade-in duration-300"
                        onClick={() => setIsMenuOpen(false)}
                    />
                )}

                {/* Mobile Menu Content */}
                {isMenuOpen && (
                    <div className="md:hidden glass border-t border-border animate-in slide-in-from-top-4 duration-300">
                        <div className="px-4 pt-2 pb-6 space-y-1">
                            <Link
                                href="/markets"
                                className="block px-3 py-2 text-base font-medium text-muted-foreground hover:text-primary hover:bg-muted/50 rounded-lg transition-colors"
                                onClick={() => setIsMenuOpen(false)}
                            >
                                Markets
                            </Link>
                            <Link
                                href="/create"
                                className="block px-3 py-2 text-base font-medium text-muted-foreground hover:text-primary hover:bg-muted/50 rounded-lg transition-colors"
                                onClick={() => setIsMenuOpen(false)}
                            >
                                Create
                            </Link>
                            {isConnected && (
                                <Link
                                    href="/activity"
                                    className="block px-3 py-2 text-base font-medium text-muted-foreground hover:text-primary hover:bg-muted/50 rounded-lg transition-colors"
                                    onClick={() => setIsMenuOpen(false)}
                                >
                                    Activity
                                </Link>
                            )}
                            {isConnected && (
                                <>
                                    <Link
                                        href="/dashboard"
                                        className="block px-3 py-2 text-base font-medium text-muted-foreground hover:text-primary hover:bg-muted/50 rounded-lg transition-colors"
                                        onClick={() => setIsMenuOpen(false)}
                                    >
                                        Dashboard
                                    </Link>
                                    <button
                                        onClick={() => {
                                            disconnect();
                                            setIsMenuOpen(false);
                                        }}
                                        className="w-full text-left px-3 py-2 text-base font-medium text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                                    >
                                        Sign Out
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </nav>
        </div>
    );
}
