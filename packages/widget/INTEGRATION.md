# @predinex/widget — Integration Guide

Embed live Predinex prediction pools on any website in minutes.

---

## Installation

### npm / pnpm / yarn

```bash
npm install @predinex/widget
```

### Script tag (UMD build — no bundler needed)

```html
<script src="https://unpkg.com/@predinex/widget/dist/index.js"></script>
<script src="https://unpkg.com/react/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom/umd/react-dom.production.min.js"></script>
```

---

## Quick start (React)

```tsx
import { PredinexWidget } from '@predinex/widget';

// You must supply fetchPool and placeBet — see "Data adapters" below.
<PredinexWidget
  contractId="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCN3"
  poolId={1}
  fetchPool={fetchPoolFromSoroban}
  placeBet={placeBetWithFreighter}
/>
```

---

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `contractId` | `string` | ✅ | Soroban contract ID |
| `poolId` | `number` | — | Pool to display. Omit to show empty hint. |
| `theme` | `WidgetTheme` | — | Theme overrides (see below) |
| `onBet` | `(poolId, outcome, amount) => void` | — | Called on successful bet |
| `fetchPool` | `(contractId, poolId) => Promise<WidgetPool>` | — | Custom data fetcher |
| `placeBet` | `(contractId, poolId, outcome, amount) => Promise<txId>` | — | Custom bet submitter |

---

## Theming

```tsx
<PredinexWidget
  contractId="..."
  poolId={1}
  theme={{
    primaryColor: '#f59e0b',   // any CSS color
    mode: 'dark',              // 'light' | 'dark'
    borderRadius: 8,           // px
    fontFamily: 'Inter, sans-serif',
  }}
  fetchPool={...}
/>
```

All theme values map to CSS custom properties (`--pdx-*`) on the root element, so you can also override them with plain CSS:

```css
.pdx-widget {
  --pdx-primary: hotpink;
}
```

---

## Data adapters

The widget ships without a bundled Soroban RPC client to stay dependency-free. Supply thin adapter functions:

```ts
import { SorobanRpc, Contract, xdr } from '@stellar/stellar-sdk';

const server = new SorobanRpc.Server('https://soroban-testnet.stellar.org');

export async function fetchPoolFromSoroban(contractId: string, poolId: number) {
  const contract = new Contract(contractId);
  // call get_pool(poolId) and map the result to WidgetPool
  // ...
}

export async function placeBetWithFreighter(
  contractId: string,
  poolId: number,
  outcome: number,
  amount: number
): Promise<string> {
  // Build + sign + submit a place_bet transaction via Freighter
  // Return the transaction hash
  // ...
}
```

---

## iframe / script-tag embedding (no React required)

For non-React sites, render into a div with the UMD build:

```html
<div id="predinex-widget"></div>
<script>
  ReactDOM.createRoot(document.getElementById('predinex-widget')).render(
    React.createElement(PredinexWidget.PredinexWidget, {
      contractId: 'CDLZFC3...',
      poolId: 1,
      fetchPool: myFetchPool,
      placeBet: myPlaceBet,
    })
  );
</script>
```

Or wrap the widget URL in an `<iframe>` if you host the widget as a standalone page (sandboxed execution):

```html
<iframe
  src="https://app.predinex.io/embed/pool/1"
  width="440"
  height="320"
  frameborder="0"
  sandbox="allow-scripts allow-same-origin allow-forms"
  title="Predinex prediction pool"
></iframe>
```

---

## Responsive / mobile

The widget sets `max-width: 420px` and uses relative units throughout. Drop it inside any responsive grid — it will shrink to fit.

---

## Security

- No cookies, no localStorage access.
- All contract calls go through the consumer-supplied `fetchPool` / `placeBet` functions — the widget never makes network requests on its own.
- `iframe` embed option supports the `sandbox` attribute for full isolation.
