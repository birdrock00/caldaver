#!/usr/bin/env bash
set -euo pipefail

avd_name="${CALDAVER_ANDROID_AVD:-caldaver_api35_clean}"
sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Android/Sdk}}"
emulator="${CALDAVER_ANDROID_EMULATOR:-$sdk_root/emulator/emulator}"
gpu_mode="${CALDAVER_ANDROID_GPU_MODE:-host}"
log_dir="${CALDAVER_ANDROID_EMULATOR_LOG_DIR:-$(pwd)/build/android-emulator}"
log_file="$log_dir/$(date -u +%Y%m%dT%H%M%SZ)-${avd_name}.log"
xvfb_screen="${CALDAVER_ANDROID_XVFB_SCREEN:-1280x1920x24}"

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

[[ -x "$emulator" ]] || fail "Android emulator not found: $emulator"
mkdir -p "$log_dir"

args=(
  -avd "$avd_name"
  -no-snapshot-load
  -no-snapshot-save
  -no-boot-anim
  -no-audio
  -gpu "$gpu_mode"
  -feature -Vulkan
  -verbose
)

printf 'Starting %s with %s\n' "$avd_name" "$emulator"
printf 'Logging to %s\n' "$log_file"

if [[ -z "${DISPLAY:-}" ]]; then
  command -v xvfb-run >/dev/null 2>&1 || fail "DISPLAY is unset and xvfb-run is not installed"
  exec xvfb-run -a -s "-screen 0 $xvfb_screen +extension GLX +render -noreset" "$emulator" "${args[@]}" 2>&1 | tee "$log_file"
fi

exec "$emulator" "${args[@]}" 2>&1 | tee "$log_file"
