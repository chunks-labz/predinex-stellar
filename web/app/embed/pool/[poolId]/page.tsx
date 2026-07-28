// web/app/embed/pool/[poolId]/page.tsx
// Embeddable pool widget route – renders a standalone pool card
// that can be placed inside an <iframe> on any external site.
import { Suspense } from 'react';
import { PoolEmbedWidget } from '@/components/PoolEmbedWidget';

interface EmbedPageProps {
  params: Promise<{ poolId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

// A query param may arrive as a string, an array (repeated key), or be absent.
// Collapse it to a single string with a fallback.
function pick(value: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

export default async function EmbedPoolPage({ params, searchParams }: EmbedPageProps) {
  const { poolId } = await params;
  const sp = await searchParams;

  const theme = {
    primary: pick(sp.primary, '#6366f1'),
    bg: pick(sp.bg, '#ffffff'),
    text: pick(sp.text, '#111827'),
    fontSize: pick(sp.fontSize, '14'),
  };

  return (
    <Suspense fallback={<div className="p-4 text-center text-sm">Loading pool…</div>}>
      <PoolEmbedWidget poolId={poolId} theme={theme} />
    </Suspense>
  );
}
