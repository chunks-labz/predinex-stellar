// web/lib/embed-origin.ts
// Resolves the target origin used when the embed widget talks to its host page.
//
// The widget posts pool identifiers and bet details to `window.parent`. Using
// `'*'` as the target origin would hand that data to any page that embeds the
// iframe, so the origin is resolved explicitly and messages are dropped when it
// cannot be determined.

/**
 * Origin allowed to receive embed `postMessage` payloads.
 *
 * Set `NEXT_PUBLIC_PREDINEX_ALLOWED_EMBED_ORIGIN` to pin every embed to a
 * single host page (e.g. `https://partner.example`). When unset, the origin is
 * derived from `document.referrer`, which the browser populates for the
 * embedding page under the `referrerpolicy` used by the generated snippet.
 */
const CONFIGURED_EMBED_ORIGIN = process.env.NEXT_PUBLIC_PREDINEX_ALLOWED_EMBED_ORIGIN;

/**
 * Returns the origin the widget may post to, or `null` when no specific origin
 * can be established. Callers must not fall back to `'*'` — dropping the
 * message is the safe outcome.
 */
export function resolveEmbedTargetOrigin(referrer?: string): string | null {
  const configured = CONFIGURED_EMBED_ORIGIN?.trim();
  if (configured) {
    const configuredOrigin = toOrigin(configured);
    if (configuredOrigin) return configuredOrigin;
  }

  const documentReferrer =
    referrer ?? (typeof document !== 'undefined' ? document.referrer : '');
  return toOrigin(documentReferrer);
}

/** Parses a URL string into its origin, or `null` if it is absent or malformed. */
function toOrigin(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const { origin } = new URL(rawUrl);
    // Opaque origins (e.g. `data:` URLs) serialise to "null" and are not a
    // usable postMessage target.
    return origin && origin !== 'null' ? origin : null;
  } catch {
    return null;
  }
}
