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

    // #1590 — nested routes keep their section highlighted (e.g. /markets/12
    // marks "Markets" as current) so users can tell where they are.
    const isActive = (href: string) =>
        href === '/' ? pathname === '/' : pathname === href || !!pathname?.startsWith(`${href}/`);
    const desktopLinkClass = (href: string) =>
        `text-sm font-medium transition-colors rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            isActive(href) ? 'text-primary' : 'text-muted-foreground hover:text-primary'
        }`;

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
                            <Link href="/markets" className={desktopLinkClass('/markets')} aria-current={isActive('/markets') ? 'page' : undefined}>
                                {t('nav.markets')}
                            </Link>
                            <Link href="/create" className={desktopLinkClass('/create')} aria-current={isActive('/create') ? 'page' : undefined}>
                                {t('nav.create')}
                            </Link>
                            <Link href="/pools/new" className={desktopLinkClass('/pools/new')} aria-current={isActive('/pools/new') ? 'page' : undefined}>
                                Create pool
                            </Link>
                            {isConnected && (
                                <Link href="/transactions" className={desktopLinkClass('/transactions')} aria-current={isActive('/transactions') ? 'page' : undefined}>
                                    {t('nav.transactions')}
                                </Link>
                            )}
                            {isConnected && (
                                <Link href="/activity" className={desktopLinkClass('/activity')} aria-current={isActive('/activity') ? 'page' : undefined}>
                                    {t('nav.activity')}
                                </Link>
                            )}
                            {isConnected && (
                                <Link href="/dashboard" className={desktopLinkClass('/dashboard')} aria-current={isActive('/dashboard') ? 'page' : undefined}>
                                    {t('nav.dashboard')}
                                </Link>
                            )}
                            {isConnected && (
                                <Link href="/favorites" className={desktopLinkClass('/favorites')} aria-current={isActive('/favorites') ? 'page' : undefined}>
                                    Favorites
                                </Link>
                            )}
                            <Link href="/analytics" className={desktopLinkClass('/analytics')} aria-current={isActive('/analytics') ? 'page' : undefined}>
                                {t('nav.analytics')}
                            </Link>
                            <Link href="/settings" className={desktopLinkClass('/settings')} aria-current={isActive('/settings') ? 'page' : undefined}>
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
                                    <Wallet className={ICON_CLASS.sm + " text-primary"} aria-hidden="true" />
                                    <span className="sr-only">{t('nav.signOut')}</span>
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={connect}
                                className="hidden md:flex items-center gap-2 bg-primary/10 hover:bg-primary/20 text-primary px-4 py-2 rounded-full border border-primary/20 transition-colors font-medium text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                aria-label="Connect Wallet"
                            >
                                <Wallet className={ICON_CLASS.sm} />
                                Connect Wallet
                            </button>
                        )}

                        </div>

                        {/* Mobile Menu Toggle - #1540: this used to live INSIDE the
                            desktop-only `hidden md:flex` actions container and was
                            gated on `!isConnected`, so the hamburger was invisible at
                            every breakpoint and connected users could never open the
                            drawer. It is now a sibling of that container: visible on
                            small screens for every wallet state. */}
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
                                aria-controls="mobile-nav-menu"
                                aria-label={isMenuOpen ? "Close menu" : "Open menu"}
                            >
                                {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
                            </button>
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
                    <div
                        id="mobile-nav-menu"
                        className="md:hidden glass border-t border-border animate-in slide-in-from-top-4 duration-300"
                    >
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
                                aria-current={isActive('/markets') ? 'page' : undefined}
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
                                aria-current={isActive('/create') ? 'page' : undefined}
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
                                aria-current={isActive('/pools/new') ? 'page' : undefined}
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
                                    aria-current={isActive('/transactions') ? 'page' : undefined}
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
                                    aria-current={isActive('/activity') ? 'page' : undefined}
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
                                        aria-current={isActive('/dashboard') ? 'page' : undefined}
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
                                        aria-current={isActive('/favorites') ? 'page' : undefined}
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
                                        aria-current={isActive('/settings') ? 'page' : undefined}
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
                                        aria-label={t('nav.signOut')}
                                    >
                                        {t('nav.signOut')}
                                    </button>
                                </>
                            )}
                            {!isConnected && (
                                <button
                                    onClick={() => { connect(); closeMenu(); }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-base font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors"
                                >
                                    <Wallet className="w-5 h-5" />
                                    Connect Wallet
                                </button>
                            )}
                            <Link
                                href="/analytics"
                                aria-current={isActive('/analytics') ? 'page' : undefined}
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

            {/* #715 — Bottom Navigation - Mobile Only (all users) */}
            {isMounted && (
                <nav className="fixed bottom-0 left-0 right-0 md:hidden glass-panel !rounded-none !border-x-0 !border-b-0 border-t border-white/10 shadow-lg z-50" aria-label="Mobile bottom navigation" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
                    <div className="flex items-center justify-around h-16 max-w-7xl mx-auto w-full px-2">
                        <Link
                            href="/"
                            aria-current={isActive('/') ? 'page' : undefined}
                            className={`flex flex-col items-center justify-center gap-0.5 min-w-[3.5rem] p-1.5 rounded-lg transition-colors ${
                                isActive('/')
                                    ? 'text-primary bg-primary/10'
                                    : 'text-muted-foreground hover:text-primary'
                            }`}
                            aria-label="Home"
                        >
                            <Home className="h-5 w-5" />
                            <span className="text-[10px] font-medium">Home</span>
                        </Link>
                        <Link
                            href="/markets"
                            aria-current={isActive('/markets') ? 'page' : undefined}
                            className={`flex flex-col items-center justify-center gap-0.5 min-w-[3.5rem] p-1.5 rounded-lg transition-colors ${
                                isActive('/markets')
                                    ? 'text-primary bg-primary/10'
                                    : 'text-muted-foreground hover:text-primary'
                            }`}
                            aria-label="Pools"
                        >
                            <Zap className="h-5 w-5" />
                            <span className="text-[10px] font-medium">Pools</span>
                        </Link>
                        {isConnected ? (
                            <Link
                                href="/dashboard"
                                aria-current={isActive('/dashboard') ? 'page' : undefined}
                                className={`flex flex-col items-center justify-center gap-0.5 min-w-[3.5rem] p-1.5 rounded-lg transition-colors ${
                                    isActive('/dashboard')
                                        ? 'text-primary bg-primary/10'
                                        : 'text-muted-foreground hover:text-primary'
                                }`}
                                aria-label="Bets"
                            >
                                <Wallet className="h-5 w-5" />
                                <span className="text-[10px] font-medium">Bets</span>
                            </Link>
                        ) : (
                            <button
                                onClick={connect}
                                className="flex flex-col items-center justify-center gap-0.5 min-w-[3.5rem] p-1.5 rounded-lg text-muted-foreground hover:text-primary transition-colors"
                                aria-label="Connect wallet"
                            >
                                <Wallet className="h-5 w-5" />
                                <span className="text-[10px] font-medium">Connect</span>
                            </button>
                        )}
                        {isConnected ? (
                            <Link
                                href="/activity"
                                aria-current={isActive('/activity') ? 'page' : undefined}
                                className={`flex flex-col items-center justify-center gap-0.5 min-w-[3.5rem] p-1.5 rounded-lg transition-colors ${
                                    isActive('/activity')
                                        ? 'text-primary bg-primary/10'
                                        : 'text-muted-foreground hover:text-primary'
                                }`}
                                aria-label="Activity"
                            >
                                <Menu className="h-5 w-5" />
                                <span className="text-[10px] font-medium">Activity</span>
                            </Link>
                        ) : (
                            <Link
                                href="/analytics"
                                aria-current={isActive('/analytics') ? 'page' : undefined}
                                className={`flex flex-col items-center justify-center gap-0.5 min-w-[3.5rem] p-1.5 rounded-lg transition-colors ${
                                    isActive('/analytics')
                                        ? 'text-primary bg-primary/10'
                                        : 'text-muted-foreground hover:text-primary'
                                }`}
                                aria-label="Analytics"
                            >
                                <Menu className="h-5 w-5" />
                                <span className="text-[10px] font-medium">Analytics</span>
                            </Link>
                        )}
                        <Link
                            href="/settings"
                            aria-current={isActive('/settings') ? 'page' : undefined}
                            className={`flex flex-col items-center justify-center gap-0.5 min-w-[3.5rem] p-1.5 rounded-lg transition-colors ${
                                isActive('/settings')
                                    ? 'text-primary bg-primary/10'
                                    : 'text-muted-foreground hover:text-primary'
                            }`}
                            aria-label="Settings"
                        >
                            <Settings className="h-5 w-5" />
                            <span className="text-[10px] font-medium">Settings</span>
                        </Link>
                    </div>
                </nav>
            )}
        </div>
    );
}
