import os
import re
import glob

TEST_FILES_DIR = "contracts/predinex/src/"

def main():
    test_files = glob.glob(os.path.join(TEST_FILES_DIR, "*.rs"))
    for filepath in test_files:
        if filepath.endswith("lib.rs"):
            continue
            
        with open(filepath, "r") as f:
            content = f.read()
            
        # 1. Update initialize calls
        pattern_init = r"(client|t\.client)\.initialize\(\s*(&[a-zA-Z0-9_\.]+(?:\(\))?)\s*,\s*(&[a-zA-Z0-9_]+)\s*\)"
        
        def replace_initialize(match):
            caller = match.group(1)
            arg1 = match.group(2)
            arg2 = match.group(3)
            return f"{caller}.initialize({arg1}, {arg2}, {arg2})"
            
        content = re.sub(pattern_init, replace_initialize, content)
        
        # 2. Update settle_pool calls
        lines = content.split('\n')
        new_lines = []
        current_admin = "&token_admin" # fallback
        for line in lines:
            init_match = re.search(r"(client|t\.client)\.initialize\([^,]+,\s*([^,]+),\s*[^)]+\)", line)
            if init_match:
                current_admin = init_match.group(2).strip()
            
            # replace settle_pool caller
            # We want to match: `client.settle_pool(&creator, &pool_id, &0)`
            # and replace `&creator` with `current_admin`.
            # Use sub instead of search + manual concat to avoid dropping suffix
            def repl_settle(m):
                return f"{m.group(1)}{current_admin}{m.group(2)}"
            
            line = re.sub(r"((?:client|t\.client)\.settle_pool\(\s*)&[a-zA-Z0-9_]+\s*(,\s*&[a-zA-Z0-9_]+\s*,\s*[^)]+\))", repl_settle, line)
                
            new_lines.append(line)
            
        content = '\n'.join(new_lines)
        
        with open(filepath, "w") as f:
            f.write(content)

if __name__ == "__main__":
    main()
