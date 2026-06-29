// web/components/EmbedCodeSnippet.tsx
// Renders a copyable iframe embed code for any public pool.
// Drop this on the pool detail page alongside the existing pool UI.
'use client';
import { useState } from 'react';

interface Props {
  poolId: string;
  baseUrl?: string;
}

export function EmbedCodeSnippet({ poolId, baseUrl = '' }: Props) {
  const [copied, setCopied] = useState(false);
  const embedUrl = `${baseUrl}/embed/pool/${poolId}?primary=%236366f1&bg=%23ffffff&text=%23111827&fontSize=14`;
  const code = `<iframe\n  src="${embedUrl}"\n  style="border:0;width:100%;max-width:420px;height:500px"\n  loading="lazy"\n  referrerpolicy="no-referrer-when-downgrade"\n></iframe>`;

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ fontFamily: 'monospace', fontSize: 13 }}>
      <p style={{ marginBottom: 6, fontFamily: 'system-ui', fontSize: 14, fontWeight: 600 }}>Embed this pool</p>
      <pre style={{
        background: '#f3f4f6',
        padding: 12,
        borderRadius: 8,
        overflowX: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}>{code}</pre>
      <button
        onClick={copy}
        style={{
          marginTop: 8,
          padding: '6px 14px',
          background: '#6366f1',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        {copied ? 'Copied!' : 'Copy embed code'}
      </button>
    </div>
  );
}
