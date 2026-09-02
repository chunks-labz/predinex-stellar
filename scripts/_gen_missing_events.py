"""
Builds a Rust code block containing:
  1) Missing #[contractevent] event struct defs (symbols not yet in the module)
  2) Missing emit_* helper functions
Dumps Rust code to stdout so the user can append/edit manually.
"""
import re, textwrap
from pathlib import Path

LIB_RS = Path("contracts/predinex/src/lib.rs")
text = LIB_RS.read_text(encoding="utf-8")

all_symbols = sorted(set(re.findall(r'Symbol::new\(&?env,\s*"([^"]+)"\)', text)))
all_symbols = [s for s in all_symbols if s != "v1"]

# Parse existing helpers
existing_helpers = set(re.findall(r"fn emit_([a-z0-9_]+)\(", text))

def sym_to_helper(sym: str) -> str:
    # Convert snake_case and CamelCase to snake_case for emit_ name
    # Example: FeeConfigUpdated -> fee_config_updated, admin_set -> admin_set
    s = re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', sym)
    return s.lower()

missing = []
for sym in all_symbols:
    h = sym_to_helper(sym)
    if h not in existing_helpers:
        missing.append((sym, h))

# For each missing symbol, read a representative publish() call to infer payload shape.
def _next_publish(text: str, after: int = 0):
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

def _split_topics_payload(text: str):
    assert text.startswith("env.events().publish(")
    body = text[len("env.events().publish("): -1]
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
            arg_starts.append(i + 1)
            break
        i += 1
    topics = body[arg_starts[0]: arg_starts[1] - 1].strip()
    payload = body[arg_starts[1]:].strip()
    return topics, payload

def _symbols_from_topics(topics: str):
    if topics.startswith("(") and topics.endswith(")"):
        inner = topics[1:-1]
    else:
        inner = topics
    # Split by comma depth 0
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
    m = re.search(r'Symbol::new\([^,]*,\s*"([^"]+)"\)', parts[0])
    event_name = m.group(1) if m else None
    identifiers = parts[2:]
    return event_name, identifiers

# Collect sample info for each missing symbol
print(f"Found {len(missing)} missing emit helpers.")
print()
print("/* --- Missing structs in #[contractevent] mod --- */")
for sym, helper in missing:
    # Name the Rust struct by CamelCas-ing the snake_case symbol.
    # If already CamelCase, leave as-is.
    if "_" in sym:
        struct_name = "".join(p.capitalize() for p in sym.split("_"))
    else:
        struct_name = sym
    # Print an empty unit struct; payload details are in the helper.
    print(f"    #[event(name = \"{sym}\")]")
    print(f"    pub struct {struct_name};")
    print()

print("/* --- Missing emit helpers --- */")
# For each symbol, find a representative call to inspect identifiers + payload arity.
samples = {}
after = 0
while True:
    loc = _next_publish(text, after)
    if not loc:
        break
    s, e = loc
    call = text[s:e]
    try:
        topics, payload = _split_topics_payload(call)
        event_name, identifiers = _symbols_from_topics(topics)
    except Exception:
        after = e
        continue
    if event_name in {sym for sym, _ in missing} and event_name not in samples:
        samples[event_name] = (identifiers, payload)
    after = e

def _payload_args(payload_expr: str) -> int:
    """Best-effort count of tuple elements; if 1-tuple or not a tuple, return 0 meaning passthrough."""
    if not (payload_expr.startswith("(") and payload_expr.endswith(")")):
        return 0
    inner = payload_expr[1:-1].strip()
    if not inner:
        return 0
    depth = 0
    count = 1
    for ch in inner:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "," and depth == 0:
            count += 1
    return count

for sym, helper in missing:
    if sym in samples:
        identifiers, payload = samples[sym]
    else:
        identifiers, payload = [], "_unused: ()"
    n_args = _payload_args(payload)
    # Build fn sig
    id_params = ", ".join(f"i{idx}: _" for idx in range(len(identifiers)))
    if n_args > 1:
        # Flatten tuple payload
        flat_params = ", ".join(f"p{idx}: _" for idx in range(n_args))
        flat_args = ", ".join(f"p{idx}" for idx in range(n_args))
        params = (["env: &Env"] +
                  [f"i{idx}: _" for idx in range(len(identifiers))] +
                  [f"p{idx}: _" for idx in range(n_args)])
    else:
        params = (["env: &Env"] +
                  [f"i{idx}: _" for idx in range(len(identifiers))] +
                  ["payload: _"])
    print(f"#[allow(deprecated)]")
    print(f"fn emit_{helper}(")
    for p in params:
        print(f"    {p},")
    print(f") {{")
    id_exprs = ", ".join(f"i{idx}" for idx in range(len(identifiers)))
    if id_exprs:
        id_exprs = ", " + id_exprs
    if n_args > 1:
        payload_expr = f"({flat_args},)" if n_args == 1 else f"({flat_args})"
    else:
        payload_expr = "payload"
    topic_inner = f"Symbol::new(env, \"{sym}\"), event_version(env){id_exprs}"
    print(f"    env.events().publish(")
    print(f"        ({topic_inner}),")
    print(f"        {payload_expr},")
    print(f"    );")
    print(f"}}")
    print()
