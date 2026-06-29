'use client';

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, X, Wallet, Moon, Sun, Radio, Home, Zap, Settings } from "lucide-react";
import { useWallet } from '@/components/WalletAdapterProvider';
import { useTheme } from '@/lib/theme';
import { useI18n } from '@/app/lib/i18n';
import { ICON_CLASS } from "@/app/lib/constants";
import { WalletAddressCopyButton } from '@/components/WalletAddressCopyButton';
import { NetworkMismatchWarning } from '@/components/NetworkMismatchWarning';
import { useNetworkMismatch } from '@/lib/hooks/useNetworkMismatch';

export default function Navbar() {
    const pathname = usePathname();
    const { isConnected, address, connect, disconnect } = useWallet();
    const { theme, toggleTheme } = useTheme();
    const { isMismatch, expectedNetworkName, currentNetworkName } = useNetworkMismatch();
    const { t } = useI18n();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    const isActive = (href: string) => pathname === href;

    const closeMenu = () => setIsMenuOpen(false);

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
                        <div className="hidden md:flex items-center gap-6" role="navigation">
                            <Link href="/markets" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors" aria-label="View all markets">
                                {t('nav.markets')}
                            </Link>
                            <Link href="/create" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors" aria-label="Create a new prediction market">
                                {t('nav.create')}
                            </Link>
                            <Link href="/pools/new" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors" aria-label="Create a new pool">
                                Create pool
                            </Link>
                            {isConnected && (
                                <Link href="/transactions" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors" aria-label="View transaction history">
                                    {t('nav.transactions')}
                                </Link>
                            )}
                            {isConnected && (
                                <Link href="/activity" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors" aria-label="View activity feed">
                                    {t('nav.activity')}
                                </Link>
                            )}
                            {isConnected && (
                                <Link href="/dashboard" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors" aria-label="User dashboard">
                                    {t('nav.dashboard')}
                                </Link>
                            )}
                            {isConnected && (
                                <Link href="/favorites" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors" aria-label="View favorite markets">
                                    Favorites
                                </Link>
                            )}
                            <Link href="/analytics" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors" aria-label="Platform analytics">
                                {t('nav.analytics')}
                            </Link>
                            <Link href="/settings" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors" aria-label="Open settings">
                                {t('nav.settings')}
                            </Link>
                        </div>

                        {/* User Info & Connect Button - Desktop */}
                        <div className="hidden md:flex items-center gap-4">
                        <button
                            onClick={toggleTheme}
                            className="p-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-full border border-primary/20 transition-all hover:scale-110 active:scale-95"
                            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
                            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
                        >
                            {theme === 'light' ? <Moon className={ICON_CLASS.sm} /> : <Sun className={ICON_CLASS.sm} />}
                        </button>
                        {/* Network badge — visible only when wallet is connected */}
                        {isConnected && (
                            <span
                                title={isMismatch ? `Wallet is on ${currentNetworkName}; app requires ${expectedNetworkName}` : `Connected to ${currentNetworkName}`}
                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                                    isMismatch
                                        ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-500'
                                        : 'bg-green-500/10 border-green-500/30 text-green-500'
                                }`}
                            >
                                <Radio className="w-3 h-3" />
                                {isMismatch ? currentNetworkName : expectedNetworkName}
                            </span>
                        )}

                        {isConnected && address ? (
                            <div className="flex items-center gap-3">
                                <WalletAddressCopyButton address={address} />
                                <button
                                    onClick={disconnect}
                                    className="flex items-center gap-2 bg-primary/10 hover:bg-primary/20 text-primary px-3 py-2 rounded-full border border-primary/20 transition-colors font-medium text-sm"
                                    aria-label={t('nav.signOut')}
                                >
                                    <Wallet className={ICON_CLASS.sm + " text-primary"} />
                                </button>
                            </div>
                        ) : null}

                        {/* Mobile Menu Toggle - Show only when not connected */}
                        {!isConnected && (
                            <div className="md:hidden flex items-center gap-2">
                                <button
                                    onClick={toggleTheme}
                                    className="p-2 text-muted-foreground hover:text-primary transition-colors"
                                    aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
                                >
                                    {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
                                </button>
                                <button
                                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                                    className="p-2 text-muted-foreground hover:text-foreground transition-colors"
                                    aria-expanded={isMenuOpen}
                                    aria-label={isMenuOpen ? "Close menu" : "Open menu"}
                                >
                                    {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
                                </button>
                            </div>
                        )}
                        </div>
                    </div>
                </div>

                {/* Mobile Menu Backdrop */}
                {isMenuOpen && (
                    <div
                        className="fixed inset-0 bg-black/60 backdrop-blur-md z-[-1] md:hidden animate-in fade-in duration-300"
                        onClick={closeMenu}
                        role="presentation"
                    />
                )}

                {/* Mobile Menu Content - Slide-in Drawer */}
                {isMenuOpen && (
                    <div className="md:hidden glass border-t border-border animate-in slide-in-from-top-4 duration-300">
                        <div className="px-4 pt-2 pb-6 space-y-1">
                            {/* Network badge — mobile */}
                            {isConnected && (
                                <div className="px-3 py-2">
                                    <span
                                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                                            isMismatch
                                                ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-500'
                                                : 'bg-green-500/10 border-green-500/30 text-green-500'
                                        }`}
                                    >
                                        <Radio className="w-3 h-3" />
                                        {isMismatch ? `Wrong network: ${currentNetworkName}` : expectedNetworkName}
                                    </span>
                                </div>
                            )}
                            <Link
                                href="/markets"
                                className={`block px-3 py-2 text-base font-medium rounded-lg transition-colors ${
                                    isActive('/markets')
                                        ? 'bg-primary/10 text-primary'
                                        : 'text-muted-foreground hover:text-primary hover:bg-muted/50'
                                }`}
                                onClick={closeMenu}
                            >
                                {t('nav.markets')}
                            </Link>
                            <Link
                                href="/create"
                                className={`block px-3 py-2 text-base font-medium rounded-lg transition-colors ${
                                    isActive('/create')
                                        ? 'bg-primary/10 text-primary'
                                        : 'text-muted-foreground hover:text-primary hover:bg-muted/50'
                                }`}
                                onClick={closeMenu}
                            >
                                {t('nav.create')}
                            </Link>
                            <Link
                                href="/pools/new"
                                className={`block px-3 py-2 text-base font-medium rounded-lg transition-colors ${
                                    isActive('/pools/new')
                                        ? 'bg-primary/10 text-primary'
                                        : 'text-muted-foreground hover:text-primary hover:bg-muted/50'
                                }`}
                                onClick={closeMenu}
                            >
                                Create pool
                            </Link>
                            {isConnected && (
                                <Link
                                    href="/transactions"
                                    className={`block px-3 py-2 text-base font-medium rounded-lg transition-colors ${
                                        isActive('/transactions')
                                            ? 'bg-primary/10 text-primary'
                                            : 'text-muted-foreground hover:text-primary hover:bg-muted/50'
                                    }`}
                                    onClick={closeMenu}
                                >
                                    {t('nav.transactions')}
                                </Link>
                            )}
                            {isConnected && (
                                <Link
                                    href="/activity"
                                    className={`block px-3 py-2 text-base font-medium rounded-lg transition-colors ${
                                        isActive('/activity')
                                            ? 'bg-primary/10 text-primary'
                                            : 'text-muted-foreground hover:text-primary hover:bg-muted/50'
                                    }`}
                                    onClick={closeMenu}
                                >
                                    {t('nav.activity')}
                                </Link>
                            )}
                            {isConnected && (
                                <>
                                    <Link
                                        href="/dashboard"
                                        className={`block px-3 py-2 text-base font-medium rounded-lg transition-colors ${
                                            isActive('/dashboard')
                                                ? 'bg-primary/10 text-primary'
                                                : 'text-muted-foreground hover:text-primary hover:bg-muted/50'
                                        }`}
                                        onClick={closeMenu}
                                    >
                                        {t('nav.dashboard')}
                                    </Link>
                                    <Link
                                        href="/favorites"
                                        className={`block px-3 py-2 text-base font-medium rounded-lg transition-colors ${
                                            isActive('/favorites')
                                                ? 'bg-primary/10 text-primary'
                                                : 'text-muted-foreground hover:text-primary hover:bg-muted/50'
                                        }`}
                                        onClick={closeMenu}
                                    >
                                        Favorites
                                    </Link>
                                    <Link
                                        href="/settings"
                                        className={`block px-3 py-2 text-base font-medium rounded-lg transition-colors ${
                                            isActive('/settings')
                                                ? 'bg-primary/10 text-primary'
                                                : 'text-muted-foreground hover:text-primary hover:bg-muted/50'
                                        }`}
                                        onClick={closeMenu}
                                    >
                                        {t('nav.settings')}
                                    </Link>
                                    <button
                                        onClick={() => {
                                            disconnect();
                                            closeMenu();
                                        }}
                                        className="w-full text-left px-3 py-2 text-base font-medium text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                                    >
                                        {t('nav.signOut')}
                                    </button>
                                </>
                            )}
                            <Link
                                href="/analytics"
                                className={`block px-3 py-2 text-base font-medium rounded-lg transition-colors ${
                                    isActive('/analytics')
                                        ? 'bg-primary/10 text-primary'
                                        : 'text-muted-foreground hover:text-primary hover:bg-muted/50'
                                }`}
                                onClick={closeMenu}
                            >
                                {t('nav.analytics')}
                            </Link>
                        </div>
                    </div>
                )}
            </nav>

            {/* Bottom Navigation - Mobile Only (Connected State) */}
            {isMounted && isConnected && (
                <nav className="fixed bottom-0 left-0 right-0 md:hidden glass-panel !rounded-none !border-x-0 !border-b-0 border-t border-white/10 shadow-lg" aria-label="Mobile bottom navigation">
                    <div className="flex items-center justify-around h-16 max-w-7xl mx-auto w-full px-4">
                        <Link
                            href="/"
                            className={`flex flex-col items-center justify-center gap-1 p-2 rounded-lg transition-colors ${
                                isActive('/')
                                    ? 'text-primary bg-primary/10'
                                    : 'text-muted-foreground hover:text-primary'
                            }`}
                            aria-label="Home"
                            title="Home"
                        >
                            <Home className="h-5 w-5" />
                            <span className="text-xs font-medium">Home</span>
                        </Link>
                        <Link
                            href="/markets"
                            className={`flex flex-col items-center justify-center gap-1 p-2 rounded-lg transition-colors ${
                                isActive('/markets')
                                    ? 'text-primary bg-primary/10'
                                    : 'text-muted-foreground hover:text-primary'
                            }`}
                            aria-label="Markets"
                            title="Markets"
                        >
                            <Zap className="h-5 w-5" />
                            <span className="text-xs font-medium">Markets</span>
                        </Link>
                        <Link
                            href="/dashboard"
                            className={`flex flex-col items-center justify-center gap-1 p-2 rounded-lg transition-colors ${
                                isActive('/dashboard')
                                    ? 'text-primary bg-primary/10'
                                    : 'text-muted-foreground hover:text-primary'
                            }`}
                            aria-label="Dashboard"
                            title="Dashboard"
                        >
                            <span className="text-lg">📊</span>
                            <span className="text-xs font-medium">Dashboard</span>
                        </Link>
                        <button
                            onClick={toggleTheme}
                            className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg text-muted-foreground hover:text-primary transition-colors"
                            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
                            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
                        >
                            {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
                            <span className="text-xs font-medium">Theme</span>
                        </button>
                        <Link
                            href="/settings"
                            className={`flex flex-col items-center justify-center gap-1 p-2 rounded-lg transition-colors ${
                                isActive('/settings')
                                    ? 'text-primary bg-primary/10'
                                    : 'text-muted-foreground hover:text-primary'
                            }`}
                            aria-label="Settings"
                            title="Settings"
                        >
                            <Settings className="h-5 w-5" />
                            <span className="text-xs font-medium">Settings</span>
                        </Link>
                    </div>
                </nav>
            )}
        </div>
    );
}
