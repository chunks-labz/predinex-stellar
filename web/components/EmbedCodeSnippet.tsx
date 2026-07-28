// web/components/EmbedCodeSnippet.tsx
// Renders a copyable iframe embed code for any public pool.
// Drop this on the pool detail page alongside the existing pool UI.
'use client';
import { useState } from 'react';

interface Props {
  poolId: string;
  baseUrl?: string;
}

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes a value for safe interpolation into a double-quoted HTML attribute.
 * Without this a `baseUrl` containing `"` or `>` could close the `src`
 * attribute — or the `<iframe>` tag itself — and inject arbitrary markup into
 * whatever page pastes the generated snippet.
 */
function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char]);
}

/**
 * Reduces `baseUrl` to a form that is safe to use as an iframe `src` prefix.
 *
 * Only absolute http(s) origins and site-relative paths are accepted; anything
 * else (`javascript:`, `data:`, protocol-relative URLs, malformed input) falls
 * back to the empty string, which yields a same-origin relative embed URL.
 * Escaping alone would not stop a `javascript:` prefix from producing a
 * snippet that executes script in the embedding page.
 */
function sanitizeBaseUrl(rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';

  if (trimmed.startsWith('/')) {
    // Protocol-relative ("//evil.example") is not site-relative — reject it.
    return trimmed.startsWith('//') ? '' : trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return trimmed;
  } catch {
    return '';
  }
}

export function EmbedCodeSnippet({ poolId, baseUrl = '' }: Props) {
  const [copied, setCopied] = useState(false);
  const embedUrl = `${sanitizeBaseUrl(baseUrl)}/embed/pool/${encodeURIComponent(poolId)}?primary=%236366f1&bg=%23ffffff&text=%23111827&fontSize=14`;
  const code = `<iframe\n  src="${escapeHtmlAttribute(embedUrl)}"\n  style="border:0;width:100%;max-width:420px;height:500px"\n  loading="lazy"\n  referrerpolicy="no-referrer-when-downgrade"\n></iframe>`;

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
