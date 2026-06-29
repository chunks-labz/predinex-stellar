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
        # Match `initialize(..., ...)` ensuring there's exactly one comma, ignoring trailing semicolon
        # We can just match `.initialize(` up to `)` 
        def replace_initialize(match):
            caller = match.group(1)
            args_str = match.group(2)
            args = [a.strip() for a in args_str.split(',')]
            if len(args) == 2:
                return f"{caller}.initialize({args[0]}, {args[1]}, {args[1]})"
            return match.group(0)
            
        content = re.sub(r"(client|t\.client)\.initialize\(([^)]+)\)", replace_initialize, content)
        
        with open(filepath, "w") as f:
            f.write(content)

if __name__ == "__main__":
    main()
