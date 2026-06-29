.PHONY: benchmark benchmark-report test fmt clippy

CARGO := $(HOME)/.cargo/bin/cargo
CONTRACT_DIR := contracts/predinex

# Run the full performance benchmark suite and print a summary table.
# Results are written to contracts/predinex/benchmark-results.json.
benchmark:
	@echo "=== Predinex Contract Benchmark Suite ==="
	@echo ""
	@rm -f $(CONTRACT_DIR)/benchmark-results.json
	@cd $(CONTRACT_DIR) && $(CARGO) test --release bench_ -- --nocapture 2>&1 | grep -E "iters|FAILED|error"
	@echo ""
	@echo "=== Results written to $(CONTRACT_DIR)/benchmark-results.json ==="
	@$(MAKE) benchmark-report

# Pretty-print the JSON benchmark results as a markdown table.
benchmark-report:
	@if [ -f $(CONTRACT_DIR)/benchmark-results.json ]; then \
		echo ""; \
		echo "| Operation | Iterations | Avg (ms) | Total (ms) |"; \
		echo "|-----------|-----------|----------|------------|"; \
		node -e " \
			const r = JSON.parse(require('fs').readFileSync('$(CONTRACT_DIR)/benchmark-results.json','utf8')); \
			r.forEach(e => console.log('| ' + e.operation + ' | ' + e.iterations + ' | ' + e.avg_wall_ms.toFixed(3) + ' | ' + e.total_wall_ms.toFixed(3) + ' |')); \
		" 2>/dev/null || cat $(CONTRACT_DIR)/benchmark-results.json; \
	fi

test:
	cd $(CONTRACT_DIR) && $(CARGO) test

fmt:
	cd $(CONTRACT_DIR) && $(CARGO) fmt

clippy:
	cd $(CONTRACT_DIR) && $(CARGO) clippy -- -D warnings
