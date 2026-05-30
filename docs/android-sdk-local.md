# Local Android SDK setup

This project can build its Android APK with Google's Linux command-line tools
without installing Android Studio. The helper script installs the SDK in a
workstation-local directory, installs the Android packages required by the
checked-in Gradle project, and can run the debug APK build.

The script uses the Android Developers command-line tools package currently
listed for Linux on
<https://developer.android.com/studio#command-line-tools-only>:

- Package: `commandlinetools-linux-14742923_latest.zip`
- URL: `https://dl.google.com/android/repository/commandlinetools-linux-14742923_latest.zip`
- Android Developers checksum field:
  `48833c34b761c10cb20bcd16582129395d121b27`

The Android Developers download table labels the checksum column as SHA-256.
The Linux command-line-tools row currently publishes a 40-character hex value,
so the setup script validates the archive with the checksum command that
matches the published checksum length.

## Requirements

- Linux x86_64 workstation or agent
- JDK 21 or newer on `PATH`
- `bash`, `unzip`, `sha1sum`, and either `curl` or `wget`
- Network access to `dl.google.com` and Android/Gradle repositories

## Install the SDK

From the repository root:

```sh
scripts/android-sdk-setup.sh
```

By default this installs the SDK at `~/.local/share/android-sdk` and caches the
download under `~/.cache/caldaver/android-sdk`. To use a repo-local SDK instead:

```sh
ANDROID_SDK_ROOT="$PWD/.android-sdk" scripts/android-sdk-setup.sh
```

The script installs:

- `platform-tools`
- `platforms;android-36`
- `build-tools;36.0.0`

Override these when needed:

```sh
scripts/android-sdk-setup.sh \
  --api-level 36 \
  --build-tools 36.0.0 \
  --package "extras;google;m2repository"
```

## Build the debug APK

Install the SDK and run the Android Gradle wrapper in one step:

```sh
scripts/android-sdk-setup.sh --build
```

This runs `android/gradlew --no-daemon assembleDebug` with `ANDROID_HOME` and
`ANDROID_SDK_ROOT` pointing at the installed SDK. The debug APK is produced by
Gradle under:

```text
android/app/build/outputs/apk/debug/
```

To run a different Gradle task:

```sh
scripts/android-sdk-setup.sh --build --gradle-task bundleDebug
```

## Local properties

Gradle can use `ANDROID_SDK_ROOT` directly, so the script does not write
`android/local.properties` by default. If a local workflow needs that file:

```sh
scripts/android-sdk-setup.sh --write-local-properties
```

`local.properties` is workstation-specific and should not contain secrets.

## CI and agent notes

- The script accepts Android SDK licenses by default with `sdkmanager
  --licenses`. Use `--no-accept-licenses` for interactive or pre-licensed
  environments.
- Use `--force-download` to replace `cmdline-tools/latest` with a fresh copy of
  the configured Google ZIP.
- Keep signing keys, keystores, passwords, and Play credentials outside the
  repository. This helper builds unsigned/debug artifacts only unless a Gradle
  task is configured elsewhere.
