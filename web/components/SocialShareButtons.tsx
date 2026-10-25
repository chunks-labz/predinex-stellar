/**
 * SocialShareButtons Component
 * Issue #1532: UX Iteration 2 - Social sharing
 */
'use client';
import { Share2, Copy, Check } from 'lucide-react';
import { useState } from 'react';

interface SocialShareButtonsProps {
  marketTitle: string;
  marketId: number;
}

export function SocialShareButtons({ marketTitle, marketId }: SocialShareButtonsProps) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined' ? `${window.location.origin}/markets/${marketId}` : '';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (navigator.share) {
      await navigator.share({ title: marketTitle, url });
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button onClick={handleCopy} className="px-3 py-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors flex items-center gap-2">
        {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
        <span className="text-sm">{copied ? 'Copied!' : 'Copy Link'}</span>
      </button>
      {navigator.share && (
        <button onClick={handleShare} className="px-3 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors flex items-center gap-2">
          <Share2 className="w-4 h-4" />
          <span className="text-sm">Share</span>
        </button>
      )}
    </div>
  );
}
