'use client';

import { useState } from 'react';
import { 
  BarChart3, 
  History, 
  TrendingUp, 
  Gift, 
  ChevronRight,
  Menu,
  X
} from 'lucide-react';

interface DashboardLayoutProps {
  children: React.ReactNode;
  activeSection: 'portfolio' | 'history' | 'statistics' | 'claims';
  onSectionChange: (section: 'portfolio' | 'history' | 'statistics' | 'claims') => void;
  breadcrumbs?: Array<{ label: string; href?: string }>;
}

export default function DashboardLayout({ 
  children, 
  activeSection, 
  onSectionChange, 
  breadcrumbs = [] 
}: DashboardLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navigationItems = [
    {
      id: 'portfolio' as const,
      label: 'Portfolio',
      icon: TrendingUp,
      description: 'Active bets and performance'
    },
    {
      id: 'history' as const,
      label: 'History',
      icon: History,
      description: 'Betting history and analytics'
    },
    {
      id: 'claims' as const,
      label: 'Claims',
      icon: Gift,
      description: 'Claimable winnings'
    },
    {
      id: 'statistics' as const,
      label: 'Statistics',
      icon: BarChart3,
      description: 'Market and platform metrics'
    }
  ];

  const handleSectionChange = (section: typeof activeSection) => {
    onSectionChange(section);
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile Menu Button */}
      <div className="lg:hidden fixed top-20 left-4 z-50">
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 bg-background border border-muted/50 rounded-lg shadow-lg"
        >
          {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      <div className="flex">
        {/* Sidebar Navigation */}
        <div className={`
          fixed lg:static inset-y-0 left-0 z-40 w-64 bg-background border-r border-muted/50 
          transform transition-transform duration-200 ease-in-out lg:transform-none
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}>
          <div className="flex flex-col h-full pt-20 lg:pt-8">
            {/* Navigation Header */}
            <div className="px-6 pb-6">
              <h2 className="text-xl font-bold">Dashboard</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Track your betting performance
              </p>
            </div>

            {/* Navigation Items */}
            <nav className="flex-1 px-4 space-y-2">
              {navigationItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSectionChange(item.id)}
                    className={`
                      w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all duration-200
                      ${isActive 
                        ? 'bg-primary/10 text-primary border border-primary/20' 
                        : 'hover:bg-muted/50 text-muted-foreground hover:text-foreground'
                      }
                    `}
                  >
                    <Icon className="w-5 h-5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{item.label}</div>
                      <div className="text-xs opacity-75 truncate">{item.description}</div>
                    </div>
                    {isActive && <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0" />}
                  </button>
                );
              })}
            </nav>

            {/* Footer */}
            <div className="p-4 border-t border-muted/20">
              <div className="text-xs text-muted-foreground text-center">
                Real-time data updates every 30s
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Overlay */}
        {isMobileMenuOpen && (
          <div 
            className="fixed inset-0 bg-black/50 z-30 lg:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Main Content */}
        <div className="flex-1 lg:ml-0">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12 pl-14 sm:pl-6 lg:pl-8">
            {/* Breadcrumbs */}
            {breadcrumbs.length > 0 && (
              <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
                <span>Dashboard</span>
                {breadcrumbs.map((crumb, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <ChevronRight className="w-4 h-4" />
                    {crumb.href ? (
                      <a href={crumb.href} className="hover:text-foreground transition-colors">
                        {crumb.label}
                      </a>
                    ) : (
                      <span className="text-foreground">{crumb.label}</span>
                    )}
                  </div>
                ))}
              </nav>
            )}

            {/* Section Header */}
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-2">
                {(() => {
                  const activeItem = navigationItems.find(item => item.id === activeSection);
                  if (!activeItem) return null;
                  const Icon = activeItem.icon;
                  return (
                    <>
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <Icon className="w-6 h-6 text-primary" />
                      </div>
                      <div>
                        <h1 className="text-2xl font-bold">{activeItem.label}</h1>
                        <p className="text-muted-foreground">{activeItem.description}</p>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Content */}
            <div className="space-y-8">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}