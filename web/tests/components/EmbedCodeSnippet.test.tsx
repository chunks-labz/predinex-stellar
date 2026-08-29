/**
 * The embed snippet is a raw HTML string that users paste into third-party
 * pages, so anything interpolated into it must be escaped. These tests pin
 * down that a hostile or misconfigured `baseUrl` cannot break out of the
 * `src` attribute or the `<iframe>` tag.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { EmbedCodeSnippet } from '@/components/EmbedCodeSnippet';

function snippetFor(props: { poolId: string; baseUrl?: string }): string {
  const { container } = render(<EmbedCodeSnippet {...props} />);
  return container.querySelector('pre')!.textContent ?? '';
}

describe('EmbedCodeSnippet', () => {
  it('renders a working embed snippet for a normal base URL', () => {
    const code = snippetFor({ poolId: '42', baseUrl: 'https://predinex.app' });
    expect(code).toContain('src="https://predinex.app/embed/pool/42?primary=%236366f1');
    expect(code).toContain('<iframe');
    expect(code).toContain('referrerpolicy="no-referrer-when-downgrade"');
  });

  it('produces a relative embed URL when no base URL is given', () => {
    expect(snippetFor({ poolId: '42' })).toContain('src="/embed/pool/42?');
  });

  it('escapes a double quote so the src attribute cannot be closed', () => {
    const code = snippetFor({
      poolId: '42',
      baseUrl: 'https://evil.example/"onload="alert(1)',
    });
    expect(code).not.toContain('"onload="');
    expect(code).toContain('&quot;onload=&quot;');
  });

  it('escapes angle brackets so the iframe tag cannot be closed', () => {
    const code = snippetFor({
      poolId: '42',
      baseUrl: 'https://evil.example/></iframe><script>alert(1)</script>',
    });
    expect(code).not.toContain('<script>');
    expect(code).not.toContain('</iframe><');
    expect(code).toContain('&lt;script&gt;');
  });

  it('escapes ampersands in the query string', () => {
    const code = snippetFor({ poolId: '42', baseUrl: 'https://predinex.app' });
    expect(code).toContain('&amp;bg=%23ffffff');
    expect(code).not.toMatch(/&(?!amp;|quot;|lt;|gt;|#39;)/);
  });

  it('escapes single quotes', () => {
    const code = snippetFor({ poolId: "42' onload='alert(1)" });
    expect(code).not.toContain("' onload='");
  });

  it.each([
    ['javascript: scheme', 'javascript:alert(1)'],
    ['data: scheme', 'data:text/html,<script>alert(1)</script>'],
    ['protocol-relative URL', '//evil.example'],
    ['malformed URL', 'https://'],
  ])('drops a base URL using a %s', (_label, baseUrl) => {
    const code = snippetFor({ poolId: '42', baseUrl });
    expect(code).toContain('src="/embed/pool/42?');
  });

  it('accepts a site-relative base path', () => {
    expect(snippetFor({ poolId: '42', baseUrl: '/staging' })).toContain(
      'src="/staging/embed/pool/42?',
    );
  });

  it('does not double the slash when the base URL has a trailing slash', () => {
    const code = snippetFor({ poolId: '42', baseUrl: 'https://predinex.app/' });
    expect(code).toContain('src="https://predinex.app/embed/pool/42?');
  });

  it('percent-encodes the pool id', () => {
    const code = snippetFor({ poolId: 'a b/c' });
    expect(code).toContain('src="/embed/pool/a%20b%2Fc?');
  });

  it('shows the copy button alongside the snippet', () => {
    render(<EmbedCodeSnippet poolId="42" />);
    expect(screen.getByRole('button', { name: /copy embed code/i })).toBeInTheDocument();
  });
});
