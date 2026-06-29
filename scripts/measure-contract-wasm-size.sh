#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF' >&2
Usage: measure-contract-wasm-size.sh --manifest-path <path> --report-path <path> [--package <name>] [--out-dir <dir>]
EOF
  exit 2
}

normalize_bool() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

manifest_path=""
report_path=""
package_name="${CONTRACT_PACKAGE_NAME:-}"
out_dir=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest-path)
      manifest_path="${2:-}"
      shift 2
      ;;
    --report-path)
      report_path="${2:-}"
      shift 2
      ;;
    --package)
      package_name="${2:-}"
      shift 2
      ;;
    --out-dir)
      out_dir="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      ;;
  esac
done

[ -n "$manifest_path" ] || usage
[ -n "$report_path" ] || usage

if [ -z "$package_name" ]; then
  package_name="$(awk -F'"' '/^name = "/ { print $2; exit }' "$manifest_path")"
fi

[ -n "$package_name" ] || {
  echo "Could not determine package name from $manifest_path" >&2
  exit 2
}

limit_bytes="${WASM_SIZE_LIMIT_BYTES:-327680}"
warn_percent="${WASM_SIZE_WARN_PERCENT:-80}"
fail_percent="${WASM_SIZE_FAIL_PERCENT:-95}"
build_optimize="$(normalize_bool "${WASM_SIZE_BUILD_OPTIMIZE:-true}")"
enforce_thresholds="$(normalize_bool "${WASM_SIZE_ENFORCE_THRESHOLDS:-true}")"
crate_basename="${package_name//-/_}"

if [ "$warn_percent" -ge "$fail_percent" ]; then
  echo "WASM_SIZE_WARN_PERCENT must be lower than WASM_SIZE_FAIL_PERCENT" >&2
  exit 2
fi

warn_threshold_bytes=$(( limit_bytes * warn_percent / 100 ))
fail_threshold_bytes=$(( limit_bytes * fail_percent / 100 ))

if [ -z "$out_dir" ]; then
  out_dir="$(mktemp -d)"
fi
mkdir -p "$out_dir"
mkdir -p "$(dirname "$report_path")"

build_cmd=(
  stellar contract build
  --manifest-path "$manifest_path"
  --package "$package_name"
  --out-dir "$out_dir"
  --locked
)

if [ "$build_optimize" = "true" ]; then
  build_cmd+=(--optimize)
fi

"${build_cmd[@]}"

optimized_wasm="$out_dir/$crate_basename.optimized.wasm"
default_wasm="$out_dir/$crate_basename.wasm"
wasm_path=""

if [ -f "$optimized_wasm" ]; then
  wasm_path="$optimized_wasm"
elif [ -f "$default_wasm" ]; then
  wasm_path="$default_wasm"
else
  wasm_path="$(find "$out_dir" -maxdepth 1 -type f -name '*.wasm' | sort | head -n 1)"
fi

[ -n "$wasm_path" ] && [ -f "$wasm_path" ] || {
  echo "No WASM artifact found in $out_dir after build" >&2
  exit 2
}

if stat -c%s "$wasm_path" >/dev/null 2>&1; then
  size_bytes="$(stat -c%s "$wasm_path")"
else
  size_bytes="$(stat -f%z "$wasm_path")"
fi

size_kib="$(awk "BEGIN { printf \"%.2f\", $size_bytes / 1024 }")"
limit_kib="$(awk "BEGIN { printf \"%.2f\", $limit_bytes / 1024 }")"
warn_threshold_kib="$(awk "BEGIN { printf \"%.2f\", $warn_threshold_bytes / 1024 }")"
fail_threshold_kib="$(awk "BEGIN { printf \"%.2f\", $fail_threshold_bytes / 1024 }")"
percent_of_limit="$(awk "BEGIN { printf \"%.2f\", ($size_bytes / $limit_bytes) * 100 }")"
generated_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

status="ok"
annotation_level="notice"
exit_code=0

if [ "$size_bytes" -ge "$fail_threshold_bytes" ]; then
  status="failure"
  annotation_level="error"
  exit_code=1
elif [ "$size_bytes" -ge "$warn_threshold_bytes" ]; then
  status="warning"
  annotation_level="warning"
fi

build_optimized_json=false
if [ "$build_optimize" = "true" ]; then
  build_optimized_json=true
fi

cat > "$report_path" <<EOF
{
  "generated_at": "$generated_at",
  "package_name": "$package_name",
  "manifest_path": "$manifest_path",
  "wasm_path": "$wasm_path",
  "size_bytes": $size_bytes,
  "size_kib": $size_kib,
  "limit_bytes": $limit_bytes,
  "limit_kib": $limit_kib,
  "warn_percent": $warn_percent,
  "warn_threshold_bytes": $warn_threshold_bytes,
  "warn_threshold_kib": $warn_threshold_kib,
  "fail_percent": $fail_percent,
  "fail_threshold_bytes": $fail_threshold_bytes,
  "fail_threshold_kib": $fail_threshold_kib,
  "percent_of_limit": $percent_of_limit,
  "status": "$status",
  "build_optimized": $build_optimized_json,
  "git_sha": "${GITHUB_SHA:-}",
  "git_ref": "${GITHUB_REF_NAME:-}"
}
EOF

message="$package_name WASM size is ${size_kib} KiB (${percent_of_limit}% of ${limit_kib} KiB limit; warn ${warn_threshold_kib} KiB, fail ${fail_threshold_kib} KiB)."
echo "::$annotation_level::$message"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "package_name=$package_name"
    echo "manifest_path=$manifest_path"
    echo "wasm_path=$wasm_path"
    echo "size_bytes=$size_bytes"
    echo "size_kib=$size_kib"
    echo "limit_bytes=$limit_bytes"
    echo "limit_kib=$limit_kib"
    echo "warn_percent=$warn_percent"
    echo "warn_threshold_bytes=$warn_threshold_bytes"
    echo "warn_threshold_kib=$warn_threshold_kib"
    echo "fail_percent=$fail_percent"
    echo "fail_threshold_bytes=$fail_threshold_bytes"
    echo "fail_threshold_kib=$fail_threshold_kib"
    echo "percent_of_limit=$percent_of_limit"
    echo "status=$status"
    echo "report_path=$report_path"
  } >> "$GITHUB_OUTPUT"
fi

if [ "$enforce_thresholds" = "true" ]; then
  exit "$exit_code"
fi
