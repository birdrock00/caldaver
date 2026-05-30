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

(
  cd "$workspace"
  npm run android:apk
)

cp "$workspace"/android/app/build/outputs/apk/debug/*.apk "$artifact_dir"/
ls -lh "$artifact_dir"/*.apk
