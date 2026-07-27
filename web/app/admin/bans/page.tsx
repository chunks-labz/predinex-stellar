'use client';

import { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import AuthGuard from '@/components/AuthGuard';
import { useWallet } from '@/components/WalletAdapterProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { predinexReadApi } from '@/app/lib/adapters/predinex-read-api';
import { Loader2, AlertTriangle, Search, Ban, UserCheck, History, PlusCircle, Check, X } from 'lucide-react';
import RouteErrorBoundary from '@/components/RouteErrorBoundary';

interface BannedCreator {
  address: string;
  bannedAt: number;
  reason: string;
}

interface AuditLogEntry {
  id: string;
  action: 'ban' | 'unban';
  address: string;
  performedBy: string;
  timestamp: number;
  reason?: string;
}

export default function AdminBans() {
  const wallet = useWallet();
  const { showToast } = useToast();

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(true);

  // States for banned creators and audit logs
  const [bannedCreators, setBannedCreators] = useState<BannedCreator[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Form states
  const [newAddress, setNewAddress] = useState('');
  const [newReason, setNewReason] = useState('');

  // Confirmation Modals
  const [confirmBan, setConfirmBan] = useState<{ address: string; reason: string } | null>(null);
  const [confirmUnban, setConfirmUnban] = useState<string | null>(null);

  // Verify Admin Access
  useEffect(() => {
    async function checkAccess() {
      if (!wallet.isConnected || !wallet.address) {
        setIsAdmin(false);
        setCheckingAccess(false);
        return;
      }
      setCheckingAccess(true);
      try {
        const freezeAdmin = await predinexReadApi.getFreezeAdmin();
        const contractAdmin = await predinexReadApi.getAdmin();

        const walletAddress = wallet.address.toUpperCase();
        const isAllowed =
          (freezeAdmin && walletAddress === freezeAdmin.toUpperCase()) ||
          (contractAdmin && walletAddress === contractAdmin.toUpperCase());

        setIsAdmin(!!isAllowed);
      } catch (err) {
        console.error('Failed to verify admin status', err);
        setIsAdmin(false);
      } finally {
        setCheckingAccess(false);
      }
    }
    checkAccess();
  }, [wallet.isConnected, wallet.address]);

  // Load from local storage
  useEffect(() => {
    const storedCreators = localStorage.getItem('predinex:banned-creators');
    const storedLog = localStorage.getItem('predinex:bans-audit-log');

    if (storedCreators) {
      setBannedCreators(JSON.parse(storedCreators));
    } else {
      // Mock initial data if empty to showcase empty state / functionality cleanly
      const initialMock: BannedCreator[] = [
        {
          address: 'GAJK7EY3S4GZLYZ3O4R2JSPJCD3LWYXMXU35RJWX5H3H5M3L7V3K3Q2S',
          bannedAt: Date.now() - 86400000 * 5,
          reason: 'Repeated creation of duplicate prediction markets',
        },
        {
          address: 'GB2C4V5X6Y7Z8W9A0B1C2D3E4F5G6H7I8J9K0L1M2N3O4P5Q6R7S8T9U',
          bannedAt: Date.now() - 86400000 * 2,
          reason: 'Spamming invalid outcomes in descriptions',
        }
      ];
      setBannedCreators(initialMock);
      localStorage.setItem('predinex:banned-creators', JSON.stringify(initialMock));
    }

    if (storedLog) {
      setAuditLog(JSON.parse(storedLog));
    } else {
      const initialLog: AuditLogEntry[] = [
        {
          id: 'log-1',
          action: 'ban',
          address: 'GAJK7EY3S4GZLYZ3O4R2JSPJCD3LWYXMXU35RJWX5H3H5M3L7V3K3Q2S',
          performedBy: wallet.address || 'G-ADMIN-BYPASS',
          timestamp: Date.now() - 86400000 * 5,
          reason: 'Repeated creation of duplicate prediction markets',
        },
        {
          id: 'log-2',
          action: 'ban',
          address: 'GB2C4V5X6Y7Z8W9A0B1C2D3E4F5G6H7I8J9K0L1M2N3O4P5Q6R7S8T9U',
          performedBy: wallet.address || 'G-ADMIN-BYPASS',
          timestamp: Date.now() - 86400000 * 2,
          reason: 'Spamming invalid outcomes in descriptions',
        }
      ];
      setAuditLog(initialLog);
      localStorage.setItem('predinex:bans-audit-log', JSON.stringify(initialLog));
    }
  }, [wallet.address]);

  // Save changes helper
  const saveBannedCreators = (updatedList: BannedCreator[]) => {
    setBannedCreators(updatedList);
    localStorage.setItem('predinex:banned-creators', JSON.stringify(updatedList));
  };

  const saveAuditLog = (updatedLog: AuditLogEntry[]) => {
    setAuditLog(updatedLog);
    localStorage.setItem('predinex:bans-audit-log', JSON.stringify(updatedLog));
  };

  // Actions
  const handleBanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAddress.trim()) {
      showToast('Creator address is required', 'error');
      return;
    }
    // Stellar address check pattern
    if (!/^G[A-D2-7][A-Z2-7]{54}$/.test(newAddress.trim())) {
      showToast('Invalid Stellar public address format', 'error');
      return;
    }
    if (bannedCreators.some(c => c.address.toUpperCase() === newAddress.trim().toUpperCase())) {
      showToast('Creator is already banned', 'error');
      return;
    }

    setConfirmBan({
      address: newAddress.trim(),
      reason: newReason.trim() || 'No reason provided',
    });
  };

  const executeBan = () => {
    if (!confirmBan) return;

    const newBan: BannedCreator = {
      address: confirmBan.address,
      bannedAt: Date.now(),
      reason: confirmBan.reason,
    };

    const updatedList = [newBan, ...bannedCreators];
    saveBannedCreators(updatedList);

    const logEntry: AuditLogEntry = {
      id: `log-${Date.now()}`,
      action: 'ban',
      address: confirmBan.address,
      performedBy: wallet.address || 'G-ADMIN',
      timestamp: Date.now(),
      reason: confirmBan.reason,
    };

    saveAuditLog([logEntry, ...auditLog]);
    showToast(`Creator ${confirmBan.address.slice(0, 6)}...${confirmBan.address.slice(-6)} banned successfully`, 'success');

    // Reset inputs
    setNewAddress('');
    setNewReason('');
    setConfirmBan(null);
  };

  const handleUnbanClick = (address: string) => {
    setConfirmUnban(address);
  };

  const executeUnban = () => {
    if (!confirmUnban) return;

    const updatedList = bannedCreators.filter(c => c.address !== confirmUnban);
    saveBannedCreators(updatedList);

    const logEntry: AuditLogEntry = {
      id: `log-${Date.now()}`,
      action: 'unban',
      address: confirmUnban,
      performedBy: wallet.address || 'G-ADMIN',
      timestamp: Date.now(),
    };

    saveAuditLog([logEntry, ...auditLog]);
    showToast(`Creator ${confirmUnban.slice(0, 6)}...${confirmUnban.slice(-6)} unbanned successfully`, 'success');
    setConfirmUnban(null);
  };

  // Filtering
  const filteredCreators = bannedCreators.filter(c =>
    c.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.reason.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <main className="min-h-screen bg-background text-foreground pb-12">
      <Navbar />
      <RouteErrorBoundary routeName="AdminBans">
        <AuthGuard>
          <div className="container mx-auto px-4 py-8 max-w-7xl">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">Creator Ban Management</h1>
                <p className="text-muted-foreground text-sm mt-1">
                  Manage blocked creator addresses from publishing prediction markets.
                </p>
              </div>
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full text-emerald-400 text-xs font-semibold self-start">
                <Check className="w-4 h-4" /> Admin Connected: {wallet.address ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}` : 'Bypass Mode'}
              </div>
            </div>

            {checkingAccess ? (
              <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                Checking admin permissions...
              </div>
            ) : !isAdmin ? (
              <div className="p-8 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 flex items-center gap-4 max-w-2xl mx-auto my-12">
                <AlertTriangle className="w-8 h-8 flex-shrink-0" />
                <div>
                  <h2 className="font-bold text-lg">Access Denied</h2>
                  <p className="text-sm opacity-85 mt-1">
                    You must be connected with the system admin key to access this management dashboard.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Side: Table & Search */}
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-card/40 border border-border/40 rounded-xl p-6 backdrop-blur-md">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                      <h2 className="text-xl font-bold flex items-center gap-2">
                        <Ban className="w-5 h-5 text-red-500" /> Banned Creators List
                      </h2>
                      {/* Search */}
                      <div className="relative max-w-xs w-full">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                          type="text"
                          placeholder="Search address or reason..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full bg-background border border-border/50 rounded-lg pl-9 pr-4 py-1.5 text-sm focus:border-primary focus:outline-none transition"
                        />
                      </div>
                    </div>

                    {filteredCreators.length === 0 ? (
                      <div className="py-16 text-center border border-dashed border-border/60 rounded-lg text-muted-foreground">
                        <Ban className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p className="text-sm font-semibold">No banned creators found</p>
                        <p className="text-xs opacity-70 mt-1">
                          {searchQuery ? 'Try adjusting your filters.' : 'All creators are currently authorized.'}
                        </p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-border/40 text-xs font-semibold text-muted-foreground uppercase">
                              <th className="py-3 px-4">Creator Address</th>
                              <th className="py-3 px-4">Banned On</th>
                              <th className="py-3 px-4">Reason</th>
                              <th className="py-3 px-4 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/20 text-sm">
                            {filteredCreators.map((creator) => (
                              <tr key={creator.address} className="hover:bg-muted/10 transition-colors">
                                <td className="py-4 px-4 font-mono text-xs max-w-[200px] truncate" title={creator.address}>
                                  {creator.address.slice(0, 8)}...{creator.address.slice(-8)}
                                </td>
                                <td className="py-4 px-4 text-muted-foreground text-xs">
                                  {new Date(creator.bannedAt).toLocaleDateString()}
                                </td>
                                <td className="py-4 px-4 max-w-[250px] truncate" title={creator.reason}>
                                  {creator.reason}
                                </td>
                                <td className="py-4 px-4 text-right">
                                  <button
                                    onClick={() => handleUnbanClick(creator.address)}
                                    className="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 px-3 py-1 rounded text-xs font-medium transition"
                                  >
                                    Unban
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Audit Log Panel */}
                  <div className="bg-card/40 border border-border/40 rounded-xl p-6 backdrop-blur-md">
                    <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
                      <History className="w-5 h-5 text-amber-500" /> Administrative Audit Log
                    </h2>
                    <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 divide-y divide-border/20">
                      {auditLog.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">No actions logged yet.</p>
                      ) : (
                        auditLog.map((log) => (
                          <div key={log.id} className="pt-3 first:pt-0 text-xs flex justify-between items-start gap-4">
                            <div>
                              <p className="font-semibold text-foreground">
                                {log.action === 'ban' ? 'Banned Creator' : 'Unbanned Creator'}{' '}
                                <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[10px]">
                                  {log.address.slice(0, 6)}...{log.address.slice(-6)}
                                </span>
                              </p>
                              {log.reason && (
                                <p className="text-muted-foreground italic mt-0.5">Reason: {log.reason}</p>
                              )}
                              <p className="text-[10px] text-muted-foreground/60 mt-1">
                                Performed by: {log.performedBy.slice(0, 6)}...{log.performedBy.slice(-4)}
                              </p>
                            </div>
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                              {new Date(log.timestamp).toLocaleString()}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Side: Ban Creator Form */}
                <div className="lg:col-span-1">
                  <div className="bg-card/40 border border-border/40 rounded-xl p-6 backdrop-blur-md sticky top-24">
                    <h2 className="text-xl font-bold flex items-center gap-2 mb-6">
                      <PlusCircle className="w-5 h-5 text-primary" /> Ban Creator Address
                    </h2>
                    <form onSubmit={handleBanSubmit} className="space-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                          Stellar Public Key (Address)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. GB2C...F5G6"
                          value={newAddress}
                          onChange={(e) => setNewAddress(e.target.value)}
                          className="w-full bg-background border border-border/50 rounded-lg px-4 py-2 text-sm focus:border-primary focus:outline-none transition font-mono"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                          Reason for Ban (Optional)
                        </label>
                        <textarea
                          placeholder="Provide a violation description or audit note..."
                          value={newReason}
                          onChange={(e) => setNewReason(e.target.value)}
                          rows={4}
                          className="w-full bg-background border border-border/50 rounded-lg px-4 py-2 text-sm focus:border-primary focus:outline-none transition resize-none"
                        />
                      </div>
                      <button
                        type="submit"
                        className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-2 rounded-lg text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-red-950/20"
                      >
                        <Ban className="w-4 h-4" /> Restrict Creator
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            )}
          </div>
        </AuthGuard>
      </RouteErrorBoundary>

      {/* Confirmation Dialog - Ban */}
      {confirmBan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-card border border-border/50 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-500">
              <AlertTriangle className="w-6 h-6 flex-shrink-0 animate-pulse" />
              <h3 className="text-lg font-bold">Confirm Creator Ban</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to ban this creator address from creating prediction pools?
            </p>
            <div className="bg-muted/40 p-3 rounded-lg text-xs font-mono break-all border border-border/20">
              <span className="font-semibold block mb-1 text-muted-foreground">ADDRESS:</span>
              {confirmBan.address}
            </div>
            <div className="bg-muted/40 p-3 rounded-lg text-xs border border-border/20">
              <span className="font-semibold block mb-1 text-muted-foreground">REASON:</span>
              {confirmBan.reason}
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setConfirmBan(null)}
                className="px-4 py-2 border border-border/50 rounded-lg text-sm font-semibold hover:bg-muted transition"
              >
                Cancel
              </button>
              <button
                onClick={executeBan}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition"
              >
                Confirm Ban
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog - Unban */}
      {confirmUnban && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-card border border-border/50 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-emerald-500">
              <UserCheck className="w-6 h-6 flex-shrink-0" />
              <h3 className="text-lg font-bold">Confirm Creator Unban</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to restore creation privileges for this address?
            </p>
            <div className="bg-muted/40 p-3 rounded-lg text-xs font-mono break-all border border-border/20">
              {confirmUnban}
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setConfirmUnban(null)}
                className="px-4 py-2 border border-border/50 rounded-lg text-sm font-semibold hover:bg-muted transition"
              >
                Cancel
              </button>
              <button
                onClick={executeUnban}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition"
              >
                Confirm Unban
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
