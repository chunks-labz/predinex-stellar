/* Scoped styles — injected once via <style> in WidgetRoot */
export const WIDGET_CSS = `
.pdx-widget {
  font-family: var(--pdx-font);
  background: var(--pdx-bg);
  color: var(--pdx-text);
  border: 1px solid var(--pdx-border);
  border-radius: var(--pdx-radius);
  padding: 20px;
  max-width: 420px;
  box-sizing: border-box;
}
.pdx-widget *, .pdx-widget *::before, .pdx-widget *::after {
  box-sizing: inherit;
}
.pdx-title { font-size: 1rem; font-weight: 700; margin: 0 0 6px; }
.pdx-desc  { font-size: 0.8rem; color: var(--pdx-muted); margin: 0 0 14px; }
.pdx-status {
  display: inline-block; font-size: 0.7rem; font-weight: 600;
  padding: 2px 8px; border-radius: 999px; margin-bottom: 12px;
  background: var(--pdx-primary); color: #fff;
}
.pdx-bar-wrap { background: var(--pdx-surface); border-radius: 999px; height: 8px; margin-bottom: 6px; overflow: hidden; }
.pdx-bar { height: 100%; background: var(--pdx-primary); border-radius: 999px; transition: width 0.3s ease; }
.pdx-odds { display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--pdx-muted); margin-bottom: 16px; }
.pdx-vol { font-size: 0.75rem; color: var(--pdx-muted); margin-bottom: 14px; }
.pdx-outcomes { display: flex; gap: 8px; margin-bottom: 12px; }
.pdx-outcome-btn {
  flex: 1; padding: 8px; border: 1px solid var(--pdx-border);
  border-radius: calc(var(--pdx-radius) / 2); background: var(--pdx-surface);
  color: var(--pdx-text); cursor: pointer; font-size: 0.85rem; font-weight: 600;
  transition: background 0.15s, border-color 0.15s;
}
.pdx-outcome-btn:hover  { border-color: var(--pdx-primary); }
.pdx-outcome-btn.active { background: var(--pdx-primary); color: #fff; border-color: var(--pdx-primary); }
.pdx-input-row { display: flex; gap: 8px; }
.pdx-input {
  flex: 1; padding: 8px 10px; border: 1px solid var(--pdx-border);
  border-radius: calc(var(--pdx-radius) / 2); background: var(--pdx-surface);
  color: var(--pdx-text); font-size: 0.85rem; outline: none;
}
.pdx-input:focus { border-color: var(--pdx-primary); }
.pdx-bet-btn {
  padding: 8px 16px; background: var(--pdx-primary); color: #fff;
  border: none; border-radius: calc(var(--pdx-radius) / 2);
  font-size: 0.85rem; font-weight: 700; cursor: pointer;
  transition: opacity 0.15s;
}
.pdx-bet-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.pdx-error { font-size: 0.78rem; color: #ef4444; margin-top: 8px; }
.pdx-success { font-size: 0.78rem; color: #22c55e; margin-top: 8px; }
.pdx-winner { font-weight: 700; color: var(--pdx-primary); margin-top: 8px; }
.pdx-loading { color: var(--pdx-muted); font-size: 0.85rem; padding: 8px 0; }
`;
