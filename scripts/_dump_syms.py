import re
text = open("contracts/predinex/src/lib.rs", encoding="utf-8").read()
# Pull all Symbol::new(..., "...") calls that appear inside publish topic tuples.
# Actually simpler: just print every string passed to Symbol::new, dedupe, sort.
syms = sorted(set(re.findall(r'Symbol::new\(&?env,\s*"([^"]+)"\)', text)))
for s in syms:
    if s == "v1":
        continue
    print(s)
