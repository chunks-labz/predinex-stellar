# Pool Embed Widget

Any public Predinex pool can be embedded on external sites using an `<iframe>`.

## Basic usage

```html
<iframe
  src="https://predinex.app/embed/pool/POOL_ID"
  style="border:0;width:100%;max-width:420px;height:500px"
  loading="lazy"
  referrerpolicy="no-referrer-when-downgrade"
></iframe>
```

Replace `POOL_ID` with the pool's unique identifier.

## Theme query parameters

| Parameter  | Default     | Description                   |
|------------|-------------|-------------------------------|
| `primary`  | `#6366f1`   | Accent colour (URL-encoded)   |
| `bg`       | `#ffffff`   | Widget background colour      |
| `text`     | `#111827`   | Primary text colour           |
| `fontSize` | `14`        | Base font size in px          |

Example with a dark theme:

```
/embed/pool/POOL_ID?bg=%231f2937&text=%23f9fafb&primary=%236366f1
```

## Interaction modes

- **Read-only** – visitor has no Freighter wallet detected. Shows live odds.
- **Interactive** – Freighter detected on the parent page. Bet input is enabled.

## postMessage events

The widget dispatches these events to the parent page:

```ts
// Widget is ready / pool data loaded
{ type: 'predinex:pool-embed:ready', poolId: string, height: number }

// User placed (or attempted) a bet
{ type: 'predinex:pool-embed:bet', poolId: string, outcomeId: number, amount: string }
```

Listen in the parent:

```js
window.addEventListener('message', (event) => {
  if (event.data?.type === 'predinex:pool-embed:ready') {
    // optionally resize the iframe to event.data.height
  }
});
```

## Rate limiting

The embed client enforces a 5-request / 10-second window per page session to prevent abuse of the pool data API.
