import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getPoolFromSoroban } from '../../../../lib/soroban-read-api';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const poolId = parseInt(id, 10);

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://predinex.io';
  const fallbackTitle = 'Predinex';
  const fallbackSubtitle = 'Next-Gen Prediction Markets on Stellar';

  let title = fallbackTitle;
  let subtitle = fallbackSubtitle;
  let outcomeA = '';
  let outcomeB = '';
  let status = '';
  let totalVolume = '';

  if (!isNaN(poolId)) {
    try {
      const result = await getPoolFromSoroban(poolId);
      const pool = result.pool;
      if (pool) {
        title = pool.title;
        subtitle = pool.description || `Pool #${poolId} on Predinex`;
        outcomeA = pool.outcomeA;
        outcomeB = pool.outcomeB;
        status = pool.settled ? 'Settled' : pool.status === 'expired' ? 'Expired' : 'Active';
        const vol = (pool.totalA + pool.totalB) / 1_000_000;
        totalVolume = vol.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' XLM';
      }
    } catch {
      // fallback silently
    }
  }

  const statusColor =
    status === 'Active' ? '#22c55e' : status === 'Settled' ? '#a1a1aa' : '#eab308';

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%)',
          padding: '60px',
          fontFamily: 'sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Background glow */}
        <div
          style={{
            position: 'absolute',
            top: '-100px',
            right: '-100px',
            width: '400px',
            height: '400px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)',
          }}
        />

        {/* Logo row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '40px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              background: '#6366f1',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '22px',
              fontWeight: 'bold',
              color: '#fff',
            }}
          >
            P
          </div>
          <span style={{ fontSize: '28px', fontWeight: '700', color: '#fff', letterSpacing: '-0.5px' }}>
            Predinex
          </span>
          {status && (
            <span
              style={{
                marginLeft: 'auto',
                fontSize: '14px',
                fontWeight: '600',
                color: statusColor,
                background: statusColor + '22',
                border: `1px solid ${statusColor}55`,
                borderRadius: '20px',
                padding: '4px 16px',
              }}
            >
              {status}
            </span>
          )}
        </div>

        {/* Pool title */}
        <div
          style={{
            fontSize: title.length > 60 ? '32px' : '40px',
            fontWeight: '800',
            color: '#ffffff',
            lineHeight: '1.2',
            marginBottom: '16px',
            flex: '1',
          }}
        >
          {title.length > 100 ? title.slice(0, 97) + '…' : title}
        </div>

        {/* Subtitle / description */}
        <div
          style={{
            fontSize: '18px',
            color: '#a1a1aa',
            lineHeight: '1.5',
            marginBottom: outcomeA ? '32px' : '0',
            maxWidth: '900px',
          }}
        >
          {subtitle.length > 120 ? subtitle.slice(0, 117) + '…' : subtitle}
        </div>

        {/* Outcomes */}
        {outcomeA && outcomeB && (
          <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
            <div
              style={{
                flex: 1,
                background: 'rgba(34,197,94,0.1)',
                border: '1px solid rgba(34,197,94,0.3)',
                borderRadius: '12px',
                padding: '16px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
              <span style={{ fontSize: '11px', color: '#86efac', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Yes
              </span>
              <span style={{ fontSize: '18px', fontWeight: '700', color: '#22c55e' }}>{outcomeA}</span>
            </div>
            <div
              style={{
                flex: 1,
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: '12px',
                padding: '16px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
              <span style={{ fontSize: '11px', color: '#fca5a5', textTransform: 'uppercase', letterSpacing: '1px' }}>
                No
              </span>
              <span style={{ fontSize: '18px', fontWeight: '700', color: '#ef4444' }}>{outcomeB}</span>
            </div>
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid rgba(255,255,255,0.1)',
            paddingTop: '20px',
          }}
        >
          <span style={{ fontSize: '14px', color: '#71717a' }}>{siteUrl.replace('https://', '')}</span>
          {totalVolume && (
            <span style={{ fontSize: '14px', color: '#71717a' }}>
              Volume: <span style={{ color: '#a78bfa', fontWeight: '600' }}>{totalVolume}</span>
            </span>
          )}
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
