#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
adb="${ADB_BINARY:-adb}"
app_package="${CALDAVER_ANDROID_APP_PACKAGE:-club.exampleapp.caldaver}"
app_activity="${CALDAVER_ANDROID_APP_ACTIVITY:-.MainActivity}"
apk_path="${CALDAVER_ANDROID_APK:-$repo_root/android/app/build/outputs/apk/debug/app-debug.apk}"
output_dir="${CALDAVER_ANDROID_SMOKE_DIR:-$repo_root/build/android-smoke/$(date -u +%Y%m%dT%H%M%SZ)}"
launch_wait_seconds="${CALDAVER_ANDROID_LAUNCH_WAIT_SECONDS:-8}"
adb_target=()

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

run_adb() {
  "$adb" "${adb_target[@]}" "$@"
}

select_device() {
  local devices=()

  if ! command -v "$adb" >/dev/null 2>&1; then
    if [[ -n "${ANDROID_HOME:-}" && -x "$ANDROID_HOME/platform-tools/adb" ]]; then
      adb="$ANDROID_HOME/platform-tools/adb"
    elif [[ -n "${ANDROID_SDK_ROOT:-}" && -x "$ANDROID_SDK_ROOT/platform-tools/adb" ]]; then
      adb="$ANDROID_SDK_ROOT/platform-tools/adb"
    elif [[ -x "$HOME/Android/Sdk/platform-tools/adb" ]]; then
      adb="$HOME/Android/Sdk/platform-tools/adb"
    else
      fail "adb was not found"
    fi
  fi

  if [[ -n "${ANDROID_UDID:-}" ]]; then
    adb_target=(-s "$ANDROID_UDID")
    [[ "$(run_adb get-state 2>/dev/null)" == "device" ]] || fail "ANDROID_UDID=$ANDROID_UDID is not connected"
    return 0
  fi

  mapfile -t devices < <("$adb" devices | awk 'NR > 1 && $2 == "device" { print $1 }')
  case "${#devices[@]}" in
    0) fail "No adb device is attached. Connect a phone or start an emulator." ;;
    1) adb_target=(-s "${devices[0]}") ;;
    *) fail "Multiple adb devices are attached; set ANDROID_UDID." ;;
  esac
}

[[ -f "$apk_path" ]] || fail "APK not found: $apk_path"
select_device
mkdir -p "$output_dir"

printf 'Installing %s on %s\n' "$apk_path" "${adb_target[*]}"
run_adb install -r "$apk_path" | tee "$output_dir/install.txt"

run_adb logcat -c || true

printf 'Launching %s/%s\n' "$app_package" "$app_activity"
run_adb shell am start -W -n "$app_package/$app_activity" | tee "$output_dir/launch.txt"
sleep "$launch_wait_seconds"

if ! run_adb shell pidof "$app_package" >"$output_dir/pid.txt"; then
  run_adb logcat -d >"$output_dir/logcat.txt" || true
  fail "Package $app_package is not running after launch. See $output_dir/logcat.txt"
fi

run_adb shell dumpsys window >"$output_dir/window.txt" || true
run_adb shell dumpsys activity activities >"$output_dir/activity.txt" || true
run_adb logcat -d >"$output_dir/logcat.txt" || true
run_adb exec-out screencap -p >"$output_dir/screenshot.png"

if ! grep -R "$app_package" "$output_dir/window.txt" "$output_dir/activity.txt" >/dev/null 2>&1; then
  printf 'warning: %s was running but was not visible in dumpsys focus/activity output\n' "$app_package" >&2
fi

printf 'ADB smoke evidence written to %s\n' "$output_dir"
