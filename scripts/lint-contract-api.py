#!/usr/bin/env python3
import re
import sys

def main():
    lib_path = "contracts/predinex/src/lib.rs"
    doc_path = "docs/CONTRACT_API.md"

    with open(lib_path, "r") as f:
        lib_content = f.read()

    with open(doc_path, "r") as f:
        doc_content = f.read()

    # Find all public functions in lib.rs
    pub_fns = re.findall(r'^\s*pub fn ([a-zA-Z0-9_]+)\(', lib_content, re.MULTILINE)
    
    missing = []
    for fn in pub_fns:
        # Check if the function name is mentioned in the doc, usually as `fn_name` or `fn_name(` or in a heading
        if f"`{fn}`" not in doc_content and f"`{fn}(" not in doc_content and f" {fn}(" not in doc_content and f" {fn} " not in doc_content:
            missing.append(fn)

    if missing:
        print(f"Error: The following public functions are not documented in {doc_path}:")
        for fn in missing:
            print(f" - {fn}")
        sys.exit(1)
    else:
        print(f"All {len(pub_fns)} public functions are documented in {doc_path}.")
        sys.exit(0)

if __name__ == "__main__":
    main()
