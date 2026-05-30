#!/usr/bin/env bash
set -euo pipefail

cmdline_tools_zip="commandlinetools-linux-14742923_latest.zip"
cmdline_tools_url="https://dl.google.com/android/repository/${cmdline_tools_zip}"
cmdline_tools_checksum="48833c34b761c10cb20bcd16582129395d121b27"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-${HOME}/.local/share/android-sdk}}"
cache_dir="${XDG_CACHE_HOME:-${HOME}/.cache}/caldaver/android-sdk"
android_project_dir="${repo_root}/android"
api_level="${ANDROID_API_LEVEL:-36}"
build_tools_version="${ANDROID_BUILD_TOOLS_VERSION:-36.0.0}"
gradle_task="${ANDROID_GRADLE_TASK:-assembleDebug}"
accept_licenses=1
build_apk=0
force_download=0
write_local_properties=0
extra_packages=()

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Usage: scripts/android-sdk-setup.sh [options]

Installs Google's Linux Android SDK command-line tools ZIP into a local SDK
root, installs the SDK packages needed by this Android project, and can run a
Gradle APK build.

Options:
  --sdk-root PATH              SDK install root. Default:
                               $ANDROID_SDK_ROOT, then $ANDROID_HOME, then
                               ~/.local/share/android-sdk.
  --cache-dir PATH             Download cache directory. Default:
                               ~/.cache/caldaver/android-sdk.
  --project-dir PATH           Android Gradle project. Default: ./android.
  --api-level N                Install platforms;android-N. Default: 36.
  --build-tools VERSION        Install build-tools;VERSION. Default: 36.0.0.
  --package SDK_PACKAGE        Install an additional sdkmanager package.
  --gradle-task TASK           Gradle task for --build. Default: assembleDebug.
  --build                      Build the APK after SDK setup.
  --write-local-properties     Write android/local.properties with sdk.dir.
  --no-accept-licenses         Do not run sdkmanager --licenses.
  --force-download             Re-download and reinstall cmdline-tools/latest.
  -h, --help                   Show this help.

Examples:
  scripts/android-sdk-setup.sh
  scripts/android-sdk-setup.sh --build
  ANDROID_SDK_ROOT="$PWD/.android-sdk" scripts/android-sdk-setup.sh --build
USAGE
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required but was not found"
}

check_java() {
  local version_line=""
  local major=""

  need_command java
  version_line="$(java -version 2>&1 | head -n 1)"
  major="$(printf '%s\n' "$version_line" | sed -E 's/.*version "([0-9]+).*/\1/')"
  [[ "$major" =~ ^[0-9]+$ ]] || fail "could not determine Java version from: $version_line"
  [[ "$major" -ge 21 ]] || fail "JDK 21 or newer is required for Capacitor Android; found: $version_line"
}

abs_path() {
  local path="$1"
  if [[ "$path" = /* ]]; then
    printf '%s\n' "$path"
  else
    printf '%s\n' "$(pwd)/$path"
  fi
}

java_properties_escape() {
  sed -e 's/\\/\\\\/g' -e 's/ /\\ /g' -e 's/:/\\:/g'
}

download_file() {
  local url="$1"
  local output="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 3 --connect-timeout 20 -o "$output" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$output" "$url"
  else
    fail "curl or wget is required to download Android command-line tools"
  fi
}

verify_checksum() {
  local file="$1"
  local expected="$2"
  local actual=""

  case "${#expected}" in
    64)
      need_command sha256sum
      actual="$(sha256sum "$file" | awk '{print $1}')"
      ;;
    40)
      need_command sha1sum
      actual="$(sha1sum "$file" | awk '{print $1}')"
      ;;
    *)
      fail "unsupported checksum length ${#expected} for $file"
      ;;
  esac

  [[ "$actual" == "$expected" ]] || fail "checksum mismatch for $file"
}

install_cmdline_tools() {
  local latest_dir="$sdk_root/cmdline-tools/latest"
  local sdkmanager="$latest_dir/bin/sdkmanager"
  local zip_path="$cache_dir/$cmdline_tools_zip"
  local tmp_dir=""

  if [[ -x "$sdkmanager" && "$force_download" -eq 0 ]]; then
    printf 'Android command-line tools already installed at %s\n' "$latest_dir"
    return 0
  fi

  need_command unzip
  mkdir -p "$cache_dir" "$sdk_root/cmdline-tools"

  printf 'Downloading %s\n' "$cmdline_tools_url"
  download_file "$cmdline_tools_url" "$zip_path"
  verify_checksum "$zip_path" "$cmdline_tools_checksum"

  tmp_dir="$(mktemp -d)"
  unzip -q "$zip_path" -d "$tmp_dir"

  [[ -d "$tmp_dir/cmdline-tools" ]] || fail "unexpected command-line tools ZIP layout"
  rm -rf "$latest_dir"
  mkdir -p "$(dirname "$latest_dir")"
  mv "$tmp_dir/cmdline-tools" "$latest_dir"
  rm -rf "$tmp_dir"

  [[ -x "$sdkmanager" ]] || fail "sdkmanager was not installed at $sdkmanager"
  printf 'Installed Android command-line tools at %s\n' "$latest_dir"
}

install_sdk_packages() {
  local sdkmanager="$sdk_root/cmdline-tools/latest/bin/sdkmanager"
  local license_status=0
  local packages=(
    "platform-tools"
    "platforms;android-${api_level}"
    "build-tools;${build_tools_version}"
  )

  packages+=("${extra_packages[@]}")

  if [[ "$accept_licenses" -eq 1 ]]; then
    set +e
    set +o pipefail
    yes | "$sdkmanager" --sdk_root="$sdk_root" --licenses >/dev/null
    license_status=$?
    set -e
    set -o pipefail
    [[ "$license_status" -eq 0 ]] || fail "sdkmanager license acceptance failed"
  fi

  "$sdkmanager" --sdk_root="$sdk_root" "${packages[@]}"
}

write_android_local_properties() {
  local escaped_sdk_dir=""

  [[ -d "$android_project_dir" ]] || fail "Android project directory not found: $android_project_dir"
  escaped_sdk_dir="$(printf '%s' "$sdk_root" | java_properties_escape)"
  printf 'sdk.dir=%s\n' "$escaped_sdk_dir" >"$android_project_dir/local.properties"
  printf 'Wrote %s\n' "$android_project_dir/local.properties"
}

run_gradle_build() {
  local gradlew="$android_project_dir/gradlew"

  [[ -x "$gradlew" ]] || fail "Gradle wrapper not found or not executable: $gradlew"
  (
    cd "$android_project_dir"
    ANDROID_HOME="$sdk_root" ANDROID_SDK_ROOT="$sdk_root" ./gradlew --no-daemon "$gradle_task"
  )
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sdk-root)
      [[ $# -ge 2 ]] || fail "--sdk-root requires a path"
      sdk_root="$(abs_path "$2")"
      shift 2
      ;;
    --cache-dir)
      [[ $# -ge 2 ]] || fail "--cache-dir requires a path"
      cache_dir="$(abs_path "$2")"
      shift 2
      ;;
    --project-dir)
      [[ $# -ge 2 ]] || fail "--project-dir requires a path"
      android_project_dir="$(abs_path "$2")"
      shift 2
      ;;
    --api-level)
      [[ $# -ge 2 ]] || fail "--api-level requires a value"
      api_level="$2"
      shift 2
      ;;
    --build-tools)
      [[ $# -ge 2 ]] || fail "--build-tools requires a version"
      build_tools_version="$2"
      shift 2
      ;;
    --package)
      [[ $# -ge 2 ]] || fail "--package requires an SDK package name"
      extra_packages+=("$2")
      shift 2
      ;;
    --gradle-task)
      [[ $# -ge 2 ]] || fail "--gradle-task requires a task name"
      gradle_task="$2"
      shift 2
      ;;
    --build)
      build_apk=1
      shift
      ;;
    --write-local-properties)
      write_local_properties=1
      shift
      ;;
    --no-accept-licenses)
      accept_licenses=0
      shift
      ;;
    --force-download)
      force_download=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

sdk_root="$(abs_path "$sdk_root")"
cache_dir="$(abs_path "$cache_dir")"
android_project_dir="$(abs_path "$android_project_dir")"

check_java
install_cmdline_tools
install_sdk_packages

if [[ "$write_local_properties" -eq 1 ]]; then
  write_android_local_properties
fi

if [[ "$build_apk" -eq 1 ]]; then
  run_gradle_build
fi

cat <<EOF

Android SDK setup complete.
SDK root: $sdk_root
Tools: $sdk_root/cmdline-tools/latest/bin
Platform tools: $sdk_root/platform-tools
EOF
