# Android Appium Tests

These tests exercise the installed Caldaver Android APK through its Capacitor WebView. They translate the live mobile Playwright coverage in `tests/live-ui.spec.js` where Appium can practically drive the same UI against a real installed app.

The APK is not built or installed by the Appium harness. Build a debug APK,
install and launch it with adb, then run the WebView navigation suite:

```sh
npm run android:apk
npm run android:adb-smoke
npm run test:android-appium:setup-driver
CALDAVER_USERNAME=... CALDAVER_PASSWORD=... npm run test:android-appium
```

Useful environment variables:

- `CALDAVER_BASE_URL`, defaults to `https://caldaver.example.test`
- `CALDAVER_USERNAME` and `CALDAVER_PASSWORD`, required
- `CALDAVER_ANDROID_APP_PACKAGE`, defaults to `club.exampleapp.caldaver`
- `CALDAVER_ANDROID_APP_ACTIVITY`, defaults to `.MainActivity`
- `ANDROID_UDID`, when multiple adb devices are attached
- `CALDAVER_ANDROID_EXTERNAL_APPIUM=1`, use an already running Appium server
- `APPIUM_HOST` and `APPIUM_PORT`, default to `127.0.0.1:4723`
- `CALDAVER_ANDROID_CHROMEDRIVER_AUTODOWNLOAD=1`, allow Appium to fetch a matching Chromedriver
- `CALDAVER_ANDROID_CHROMEDRIVER_EXECUTABLE`, use a specific Chromedriver binary
- `CALDAVER_ANDROID_APK`, APK path for `npm run android:adb-smoke`, defaults to `android/app/build/outputs/apk/debug/app-debug.apk`
- `CALDAVER_ANDROID_SMOKE_DIR`, evidence directory for adb install, launch, logcat, and screenshot output
- `CALDAVER_ANDROID_LAUNCH_WAIT_SECONDS`, defaults to `8`

No credentials are stored in this directory; pass them through the environment.
