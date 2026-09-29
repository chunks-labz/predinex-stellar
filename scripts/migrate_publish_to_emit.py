"""
In-place migrates all remaining `env.events().publish(...)` call sites in
contracts/predinex/src/lib.rs to their matching `emit_*` helper.

Preserves formatting and argument order. Uses pattern matching so it is safe to
re-run (already-migrated call sites are skipped because the pattern won't
match).
"""
from __future__ import annotations

import re
from pathlib import Path

LIB_RS = Path(__file__).resolve().parents[1] / "contracts" / "predinex" / "src" / "lib.rs"
assert LIB_RS.exists(), f"lib.rs not found at {LIB_RS}"

SRC = LIB_RS.read_text(encoding="utf-8")

# Helper to detect `env.events().publish(` blocks bounded by the first
# unmatched `);` after the open paren. We do NOT require unique full call
# blocks; we transform one site at a time and loop until none remain.


def _next_publish(text: str):
    m = re.search(r"\benv\.events\(\)\.publish\(\s*", text)
    if not m:
        return None
    start = m.start()
    i = m.end()
    depth = 1
    while i < len(text) and depth > 0:
        ch = text[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        i += 1
    end = i  # exclusive: index of character AFTER the final `)`
    return start, end


def _strip_call(text: str) -> tuple[str, str]:
    """Given the text of a single `env.events().publish(...)` call,
    return (topics_tuple_expr, payload_expr) strings."""
    assert text.startswith("env.events().publish(")
    body = text[len("env.events().publish("): -1]  # drop outer parens
    # Now parse the two top-level arguments: (topics_tuple), (payload_tuple_or_expr)
    # Split on commas only at depth 0, but the two args are separated by a comma
    # at depth 0 between the two tuples.
    i = 0
    depth = 0
    arg_starts = [0]
    while i < len(body):
        ch = body[i]
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "," and depth == 0:
            # Skip past the comma and any whitespace to find the next arg.
            arg_starts.append(i + 1)
            # publish() always has exactly 2 args: (topics, payload).
            break
        i += 1
    assert len(arg_starts) == 2, f"unexpected arg layout: {body[:120]!r}"
    topics = body[arg_starts[0]: arg_starts[1] - 1].strip()
    payload = body[arg_starts[1]:].strip()
    return topics, payload


# Mapping from topic[0] Symbol string to the emit helper template. Each
# template accepts a positional list of identifier topic expressions (everything
# after event_version) plus the payload expression.
#
# Shape: helper_name(env, [identifier_topics...], payload_expression)

def _topics_args(topics_expr: str):
    """topics_expr is the outermost tuple of a publish call, e.g.
    `(Symbol::new(env, "create_pool"), event_version(env), pool_id, user.clone())`.
    Returns (event_name: str, identifier_exprs: list[str]).
    """
    # Drop outer parens.
    if topics_expr.startswith("(") and topics_expr.endswith(")"):
        inner = topics_expr[1:-1]
    else:
        inner = topics_expr
    # Parse by comma, depth-aware.
    parts = []
    buf = []
    depth = 0
    for ch in inner:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
    if buf:
        parts.append("".join(buf).strip())
    # parts[0]: Symbol::new(..., "<event_name>")
    m = re.search(r'Symbol::new\([^,]*,\s*"([^"]+)"\)', parts[0])
    assert m, f"unable to parse Symbol event name: {parts[0]!r}"
    event_name = m.group(1)
    identifiers = parts[2:]  # skip parts[0]=Symbol, parts[1]=event_version
    return event_name, identifiers


# Per-event emit mapping. Keys are the topic[0] string. Values are tuples:
#   (helper_fn_name,
#    lambda(identifiers: list[str], payload: str) -> list[str] of call args)

def _emit_sig(env_expr: str, helper: str, args: list[str]) -> str:
    joined = ", ".join(args)
    return f"{helper}({env_expr}, {joined})"


def _env_arg(topics_expr: str) -> str:
    """Detect whether the topic Symbol uses `env` or `&env`.
    Heuristic: pick the first argument passed to Symbol::new inside the first
    topic. Use `&env` if that was `&env`, else `env`."""
    m = re.search(r'Symbol::new\(\s*(&?env),', topics_expr)
    if m:
        return m.group(1)
    # Fallback: look at the call site's `env.events()`
    return "env"


# One rule per symbol name; use wildcard fallbacks for generic payloads.
def _translate(event_name: str, identifiers: list[str], payload: str) -> str:
    # Strip leading/trailing parens from simple tuple payloads where emit_*
    # already flattens.
    #
    # Strategy: for events whose emit_* helpers take the payload as the last
    # N positional args (flattened tuples), we strip the outer parens of the
    # payload if the payload starts with `(` and is a tuple. For events whose
    # emit_* helpers take a single struct/value payload, we keep payload as-is.
    #
    # The emit_* helpers above match the originally published shape, which is:
    #   * struct payload: payload is a single expression e.g. `CreatePoolEvent{...}`
    #   * tuple payload: payload is a tuple expression with multiple elements.
    #
    # To decide, inspect the helper signature by event name:
    FLAT_HELPERS = {
        # fee config
        "FeeConfigUpdated": ["old_fee_rate", "old_fee_recipient", "fee_rate", "fee_recipient"],
        "creation_fee_set": ["old_fee", "fee"],
        "creation_fee_exemption_set": ["account", "exempt"],
        "protocol_fee_set": ["caller", "old_fee_bps", "fee_bps"],
        "volume_fee_tiers_set": ["caller", "tiers"],
        "pool_bet_limits_set": ["old_min_bet", "old_max_bet", "min_bet", "max_bet"],
        "circuit_breaker_config_set": ["old_max_pool_size", "old_large_pool_threshold", "old_cooling_period_secs", "max_pool_size", "large_pool_threshold", "cooling_period_secs"],
        "rate_limit_config_set": ["old_max_bets_per_window", "old_window_secs", "max_bets_per_window", "window_secs"],
        "user_exposure_config_set": ["max_exposure_per_pool_bps", "max_bet_per_transaction", "daily_loss_limit", "weekly_loss_limit", "large_bet_cooldown_secs"],
        "user_bet_limit_exceeded": ["user", "pool_id", "amount", "max"],
        "user_exposure_limit_exceeded": ["user", "pool_id", "new_exposure", "max_exposure"],
        "user_daily_loss_limit_exceeded": ["user", "potential_loss", "limit"],
        "user_weekly_loss_limit_exceeded": ["user", "potential_loss", "limit"],
        "user_large_bet_cooldown_active": ["user", "amount", "cooldown_secs"],
        # scheduled pools
        "pool_scheduled": ["creator", "open_at"],
        "scheduled_pool_activated": ["open_at"],
        "scheduled_pool_cancelled": ["creator"],
        "pool_cooling_started": ["cooling_until", "new_total"],
        "assign_settler": ["creator", "settler"],
        "min_settlement_participants_set": ["old_min", "min_participants"],
        "void_pool": ["caller"],
        "claim_refund": ["refund"],  # identifiers: user, payload = refund → helper(env, pool, user, refund)
        "claim_expired": ["refund"],
        "claim_scheduled": ["id", "claim_at"],
        "scheduled_claim_cancelled": ["scheduled_claim_id"],
        "scheduled_claim_executed": ["id", "amount"],
        "treasury_withdraw_limit_set": ["max_withdrawal_per_window", "withdrawal_window_secs"],
        "treasury_recipient_rotated": ["current_recipient", "new_recipient"],
        "treasury_withdrawn": ["caller", "treasury_recipient", "amount"],
        "freeze_admin_set": ["old_freeze_admin", "freeze_admin"],
    }

    # Helpers taking a struct payload as the last arg (identifiers are part of
    # topic tuple; payload expression is passed through as the trailing arg).
    STRUCT_PAYLOAD = {
        "create_pool",
        "place_bet",
        "referral_bet",
        "twap_updated",
        "bet_cancelled",
        "cancel_pool",
        "pool_duration_extended",
        "settle_pool",
        "refund_expired_pool",
        "claim_winnings",
    }

    helper_name = {
        "FeeConfigUpdated": "emit_fee_config_updated",
        "creation_fee_set": "emit_creation_fee_set",
        "creation_fee_exemption_set": "emit_creation_fee_exemption_set",
        "protocol_fee_set": "emit_protocol_fee_set",
        "volume_fee_tiers_set": "emit_volume_fee_tiers_set",
        "pool_bet_limits_set": "emit_pool_bet_limits_set",
        "circuit_breaker_config_set": "emit_circuit_breaker_config_set",
        "rate_limit_config_set": "emit_rate_limit_config_set",
        "user_exposure_config_set": "emit_user_exposure_config_set",
        "user_bet_limit_exceeded": "emit_user_bet_limit_exceeded",
        "user_exposure_limit_exceeded": "emit_user_exposure_limit_exceeded",
        "user_daily_loss_limit_exceeded": "emit_user_daily_loss_limit_exceeded",
        "user_weekly_loss_limit_exceeded": "emit_user_weekly_loss_limit_exceeded",
        "user_large_bet_cooldown_active": "emit_user_large_bet_cooldown_active",
        "create_pool": "emit_create_pool",
        "pool_scheduled": "emit_pool_scheduled",
        "scheduled_pool_activated": "emit_scheduled_pool_activated",
        "scheduled_pool_cancelled": "emit_scheduled_pool_cancelled",
        "pool_cooling_started": "emit_pool_cooling_started",
        "twap_updated": "emit_twap_updated",
        "place_bet": "emit_place_bet",
        "referral_bet": "emit_referral_bet",
        "bet_cancelled": "emit_bet_cancelled",
        "cancel_pool": "emit_cancel_pool",
        "pool_duration_extended": "emit_pool_duration_extended",
        "assign_settler": "emit_assign_settler",
        "min_settlement_participants_set": "emit_min_settlement_participants_set",
        "settle_pool": "emit_settle_pool",
        "void_pool": "emit_void_pool",
        "claim_refund": "emit_claim_refund",
        "claim_expired": "emit_claim_expired",
        "refund_expired_pool": "emit_refund_expired_pool",
        "claim_winnings": "emit_claim_winnings",
        "claim_scheduled": "emit_claim_scheduled",
        "scheduled_claim_cancelled": "emit_scheduled_claim_cancelled",
        "scheduled_claim_executed": "emit_scheduled_claim_executed",
        "treasury_withdraw_limit_set": "emit_treasury_withdraw_limit_set",
        "treasury_recipient_rotated": "emit_treasury_recipient_rotated",
        "treasury_withdrawn": "emit_treasury_withdrawn",
        "freeze_admin_set": "emit_freeze_admin_set",
    }.get(event_name)
    if helper_name is None:
        raise KeyError(f"No helper mapping for event symbol {event_name!r}")

    # Build the list of trailing args that get passed after the env arg.
    trailing: list[str] = []

    if event_name in STRUCT_PAYLOAD:
        # Identifiers are the extra topic args after (name, v1), which appear
        # positionally before the payload struct.
        trailing.extend(identifiers)
        trailing.append(payload)
    else:
        # FLAT helpers: identifiers appear first (as specified by publish's
        # topics tuple), then every flattened element of the payload tuple.
        trailing.extend(identifiers)
        # Try to unwrap one tuple layer.
        if payload.startswith("(") and payload.endswith(")"):
            inner = payload[1:-1]
            depth = 0
            elem = []
            for ch in inner:
                if ch in "([{":
                    depth += 1
                elif ch in ")]}":
                    depth -= 1
                if ch == "," and depth == 0:
                    trailing.append("".join(elem).strip())
                    elem = []
                else:
                    elem.append(ch)
            if elem:
                trailing.append("".join(elem).strip())
        else:
            trailing.append(payload)

    # Special-case helpers whose positional order is: env, pool, user, ...
    # (identifiers for these are already [pool_id, user,...] — the mapping
    # above already matches, nothing to shuffle.)

    return helper_name, trailing


CHANGES = 0
text = SRC
while True:
    loc = _next_publish(text)
    if not loc:
        break
    start, end = loc
    call_text = text[start:end]
    try:
        topics, payload = _strip_call(call_text)
        event_name, identifiers = _topics_args(topics)
        helper_name, trailing_args = _translate(event_name, identifiers, payload)
        env_expr = _env_arg(topics)
        new_call = _emit_sig(env_expr, helper_name, trailing_args)
    except Exception as exc:
        snippet = call_text.replace("\n", " ")[:200]
        raise SystemExit(f"Failed to migrate publish site at byte {start}: {exc}; call: {snippet!r}")
    text = text[:start] + new_call + text[end:]
    CHANGES += 1
    if CHANGES > 200:
        # Safety valve in case a publish pattern appears inside a comment or
        # string that we keep "replacing".
        raise SystemExit("safety valve reached (200 changes); aborting")

LIB_RS.write_text(text, encoding="utf-8")
print(f"Migrated {CHANGES} publish() call sites in {LIB_RS}")
