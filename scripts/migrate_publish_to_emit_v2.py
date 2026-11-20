"""
Self-contained migration for contract/predinex/src/lib.rs:
  1. Introspect all Symbol(...) names used inside env.events().publish() calls.
  2. Append missing `#[event]` unit structs to the `#[contractevent] pub mod contract_events`.
  3. Append missing `emit_*` helper functions (localized #[allow(deprecated)] so the
     global `#![allow(deprecated)]` can be removed).
  4. Rewrite every `env.events().publish(...)` call site to its matching emit_* helper.
  5. Emit summary counts.

Rerunnable (idempotent): helpers that already exist are skipped on step 2/3;
call sites not matching `env.events().publish(` are left untouched on step 4.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIB_RS = ROOT / "contracts" / "predinex" / "src" / "lib.rs"
assert LIB_RS.exists(), LIB_RS

# ── Utility: parse comma-separated elements at depth 0 ───────────────────────
def _split0(text: str) -> list[str]:
    out, buf, depth = [], [], 0
    for ch in text:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            out.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
    if buf:
        out.append("".join(buf).strip())
    return [x for x in out if x != ""]

def sym_to_helper_name(sym: str) -> str:
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", sym)
    return s.lower()

def sym_to_struct_name(sym: str) -> str:
    if "_" in sym:
        return "".join(p.capitalize() for p in sym.split("_"))
    return sym

# ── Step 0: load file ───────────────────────────────────────────────────────
src = LIB_RS.read_text(encoding="utf-8")

# ── Step 1: collect all publish call sites ───────────────────────────────────
# Each site is (start_byte, end_byte, topics_expr, payload_expr, event_symbol,
# identifier_topic_exprs, identifier_count, payload_arity_tuple or 0 if atomic).
def _parse_publish(text: str, start: int, end: int):
    call = text[start:end]
    assert call.startswith("env.events().publish(")
    body = call[len("env.events().publish("): -1]  # drop outer parens
    parts = _split0(body)
    assert len(parts) == 2, (call[:200], parts)
    topics_expr, payload_expr = parts
    # drop outer tuple parens on topics
    if topics_expr.startswith("(") and topics_expr.endswith(")"):
        t_inner = topics_expr[1:-1]
    else:
        t_inner = topics_expr
    topic_parts = _split0(t_inner)
    assert len(topic_parts) >= 2, f"topics too short: {topic_parts!r}"
    m = re.search(r"Symbol::new\([^,]*,\s*\"([^\"]+)\"\)", topic_parts[0])
    assert m, f"bad symbol: {topic_parts[0]!r}"
    event_sym = m.group(1)
    # Detect env token style: &env vs env
    env_match = re.search(r"Symbol::new\(\s*(&?env),", topic_parts[0])
    env_tok = env_match.group(1) if env_match else "env"
    identifiers = topic_parts[2:]  # skip name, skip v1
    # Payload shape: 0 if atomic expr, N if N-tuple
    if payload_expr.startswith("(") and payload_expr.endswith(")"):
        p_inner = payload_expr[1:-1].strip()
        payload_arity = len(_split0(p_inner)) if p_inner else 0
    else:
        payload_arity = 0
    return {
        "call": call,
        "topics": topics_expr,
        "payload": payload_expr,
        "sym": event_sym,
        "env_tok": env_tok,
        "idents": identifiers,  # list[str] — length = identifier_count
        "payload_arity": payload_arity,
    }


def _next_publish(text: str, after: int):
    m = re.search(r"\benv\.events\(\)\.publish\(\s*", text[after:])
    if not m:
        return None
    start = after + m.start()
    i = after + m.end()
    depth = 1
    while i < len(text) and depth > 0:
        ch = text[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        i += 1
    return start, i


sites: list[dict] = []
all_event_syms: set[str] = set()
after = 0
while True:
    loc = _next_publish(src, after)
    if not loc:
        break
    s, e = loc
    parsed = _parse_publish(src, s, e)
    sites.append({"start": s, "end": e, **parsed})
    all_event_syms.add(parsed["sym"])
    after = e

# Per-symbol: keep max identifier count and max payload arity.
per_sym_meta: dict[str, dict] = {}
for site in sites:
    sym = site["sym"]
    m = per_sym_meta.get(sym, {"max_idents": 0, "max_payload_arity": 0})
    m["max_idents"] = max(m["max_idents"], len(site["idents"]))
    m["max_payload_arity"] = max(m["max_payload_arity"], site["payload_arity"])
    per_sym_meta[sym] = m

# ── Step 2: detect existing helpers/structs ──────────────────────────────────
existing_helpers = set(re.findall(r"\bfn emit_([a-z0-9_]+)\(", src))
# Struct names we already placed: detect by scanning for `#[event(name = "X")]` lines.
existing_struct_events = set(re.findall(r'#\[event\(name\s*=\s*"([^"]+)"\)\]', src))

# ── Step 2b: inject missing structs into the contract_events mod ─────────────
# Insertion point: right before the closing brace of the mod.
MOD_END_MARKER = "\n} // end of contract_events — autogenerated marker\n"
if MOD_END_MARKER not in src:
    # Find the line `}` that closes the mod — look for the pattern after the
    # last FreezeAdminSet entry (the struct we added). Safer: find the closing
    # brace immediately followed by the emit_ helpers comment.
    m_after_mod = re.search(
        r"\n\}\s*\n// ── Emit helpers ─",
        src,
    )
    assert m_after_mod, "cannot locate #[contractevent] mod close"
    insert_at = m_after_mod.start() + 1  # insert before the '}'
    missing_structs_block_lines = []
    for sym in sorted(all_event_syms):
        if sym in existing_struct_events:
            continue
        missing_structs_block_lines.append(
            f'    #[event(name = "{sym}")]'
        )
        missing_structs_block_lines.append(
            f"    pub struct {sym_to_struct_name(sym)};"
        )
        missing_structs_block_lines.append("")
    if missing_structs_block_lines:
        src = (
            src[:insert_at]
            + "\n"
            + "\n".join(missing_structs_block_lines)
            + src[insert_at:]
        )

# ── Step 3: inject missing emit_* helpers ────────────────────────────────────
# Insertion point: right before the line with `pub const CONTRACT_STATE_VERSION`.
ANCHOR = "\npub const CONTRACT_STATE_VERSION: &str = \"v1\";\n"
anchor_pos = src.find(ANCHOR)
assert anchor_pos != -1, "cannot find CONTRACT_STATE_VERSION anchor"

helpers_block_lines = []
for sym in sorted(all_event_syms):
    helper = sym_to_helper_name(sym)
    if helper in existing_helpers:
        continue
    meta = per_sym_meta[sym]
    n_id = meta["max_idents"]
    n_pl = meta["max_payload_arity"]
    # Build parameter list
    params = ["env: &Env"]
    arg_exprs = []
    for idx in range(n_id):
        params.append(f"i{idx}: impl Into<::soroban_sdk::RawVal> + Clone")
        arg_exprs.append(f"i{idx}.clone()")
    if n_pl == 0:
        params.append("payload: impl Into<::soroban_sdk::RawVal>")
        payload_arg_expr = "payload"
    else:
        for idx in range(n_pl):
            params.append(f"p{idx}: impl Into<::soroban_sdk::RawVal> + Clone")
        payload_parts = [f"p{idx}.clone()" for idx in range(n_pl)]
        if n_pl == 1:
            payload_arg_expr = f"({payload_parts[0]},)"
        else:
            payload_arg_expr = "(" + ", ".join(payload_parts) + ")"
    # Build topic inner: Symbol(env, "name"), event_version(env), identifiers...
    topic_inner_parts = [f'Symbol::new(env, "{sym}")', "event_version(env)"] + [
        f"i{idx}.clone()" for idx in range(n_id)
    ]
    helpers_block_lines.append("#[allow(deprecated)]")
    helpers_block_lines.append(f"fn emit_{helper}(")
    for p in params:
        helpers_block_lines.append(f"    {p},")
    helpers_block_lines.append(") {")
    helpers_block_lines.append("    env.events().publish(")
    helpers_block_lines.append("        (" + ", ".join(topic_inner_parts) + "),")
    helpers_block_lines.append(f"        {payload_arg_expr},")
    helpers_block_lines.append("    );")
    helpers_block_lines.append("}")
    helpers_block_lines.append("")

if helpers_block_lines:
    src = (
        src[:anchor_pos]
        + "\n"
        + "\n".join(helpers_block_lines)
        + "\n"
        + src[anchor_pos:]
    )

# Regenerate site positions after the two injection steps above by re-parsing.
sites2: list[dict] = []
after = 0
while True:
    loc = _next_publish(src, after)
    if not loc:
        break
    s, e = loc
    parsed = _parse_publish(src, s, e)
    sites2.append({"start": s, "end": e, **parsed})
    after = e

# ── Step 4: rewrite publish calls, RIGHT to LEFT so byte positions stay valid ─
def _rewrite_site_args(site: dict) -> str:
    sym = site["sym"]
    helper = sym_to_helper_name(sym)
    env_tok = site["env_tok"]
    idents = list(site["idents"])
    payload = site["payload"]
    # Arguments after the env:
    #   identifiers in order, then the payload expression.
    #   If the payload expression is a tuple (n>1), flatten it — UNLESS a
    #   helper for this symbol already exists (in which case it was manually
    #   authored with a specific signature: keep the single payload expr).
    existing_helpers_now = set(re.findall(r"\bfn emit_([a-z0-9_]+)\(", src))
    trailing_args = list(idents)
    if helper in existing_helpers_now:
        # Manually authored; always pass the raw payload expression last.
        trailing_args.append(payload)
    else:
        # Generic helper: if payload was a tuple, flatten into positional args.
        if payload.startswith("(") and payload.endswith(")"):
            p_inner = payload[1:-1].strip()
            p_parts = _split0(p_inner) if p_inner else []
            if len(p_parts) > 1:
                trailing_args.extend(p_parts)
            else:
                # 1-tuple or not really a tuple (e.g. (expr) parens for grouping)
                # — if 0 or 1 element, just pass payload expression.
                trailing_args.append(payload)
        else:
            trailing_args.append(payload)
    all_args = [env_tok] + trailing_args
    return f"{helper}(" + ", ".join(all_args) + ")"

rewrites = 0
for site in reversed(sites2):
    new_call = _rewrite_site_args(site)
    src = src[:site["start"]] + new_call + src[site["end"]:]
    rewrites += 1

# ── Step 5: save and report ──────────────────────────────────────────────────
LIB_RS.write_text(src, encoding="utf-8")
print(f"OK: wrote {LIB_RS}")
print(f"  {len(sites2)} publish sites scanned; {rewrites} rewrites applied.")
print(f"  {sum(1 for s in per_sym_meta if s not in existing_struct_events)} new #[event] structs added.")
new_h = 0
for sym in per_sym_meta:
    h = sym_to_helper_name(sym)
    if h not in existing_helpers:
        new_h += 1
print(f"  {new_h} new emit_* helpers added.")
