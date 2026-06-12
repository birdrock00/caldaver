#!/usr/bin/env bash
set -euo pipefail

workspace="${GITHUB_WORKSPACE:-$(pwd)}"
artifact_dir="$workspace/build/android-apk"

if [[ ! -d "$workspace/android" ]]; then
  printf 'error: Android project directory was not found at %s/android\n' "$workspace" >&2
  exit 1
fi

mkdir -p "$artifact_dir"
find "$artifact_dir" -type f -name '*.apk' -delete

build_type="${BUILD_TYPE:-release}"

if [[ "$build_type" == "release" ]]; then
  keystore_file="${KEYSTORE_FILE:-$RUNNER_TEMP/release.keystore}"
  if [[ -z "${KEYSTORE_BASE64:-}" ]]; then
    printf 'error: KEYSTORE_BASE64 is required for release builds\n' >&2
    exit 1
  fi
  printf '%s' "$KEYSTORE_BASE64" | base64 -d > "$keystore_file"
  export KEYSTORE_FILE="$keystore_file"
  export KEYSTORE_PASSWORD="${KEYSTORE_PASSWORD:?KEYSTORE_PASSWORD is required}"
  export KEY_ALIAS="${KEY_ALIAS:?KEY_ALIAS is required}"
  export KEY_PASSWORD="${KEY_PASSWORD:?KEY_PASSWORD is required}"
fi

(
  cd "$workspace"
  npm run cap:sync
  npm run android:prepare-config
  if [[ "$build_type" == "release" ]]; then
    (cd android && ./gradlew assembleRelease)
    cp "$workspace"/android/app/build/outputs/apk/release/*.apk "$artifact_dir"/
  else
    (cd android && ./gradlew assembleDebug)
    cp "$workspace"/android/app/build/outputs/apk/debug/*.apk "$artifact_dir"/
  fi
)

ls -lh "$artifact_dir"/*.apk
