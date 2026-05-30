const { execFileSync } = require('child_process');

let adb = process.env.ADB_BINARY || 'adb';
const appPackage = process.env.CALDAVER_ANDROID_APP_PACKAGE || 'club.exampleapp.caldaver';
const adbTarget = process.env.ANDROID_UDID ? ['-s', process.env.ANDROID_UDID] : [];

function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

try {
  if (!process.env.ADB_BINARY) {
    const sdkCandidates = [
      process.env.ANDROID_HOME && `${process.env.ANDROID_HOME}/platform-tools/adb`,
      process.env.ANDROID_SDK_ROOT && `${process.env.ANDROID_SDK_ROOT}/platform-tools/adb`,
      `${process.env.HOME}/Android/Sdk/platform-tools/adb`
    ].filter(Boolean);

    try {
      run(adb, ['version']);
    } catch {
      const fs = require('fs');
      const candidate = sdkCandidates.find(item => fs.existsSync(item));
      if (candidate) {
        adb = candidate;
      }
    }
  }

  const devices = run(adb, ['devices']);
  const attached = devices
    .split('\n')
    .slice(1)
    .map(line => line.trim())
    .filter(line => line && /\tdevice$/.test(line));

  if (attached.length === 0) {
    fail('No adb device is attached. Start an emulator or connect a device before running Android Appium tests.');
  }

  const packagePath = run(adb, [...adbTarget, 'shell', 'pm', 'path', appPackage]);
  if (!packagePath.startsWith('package:')) {
    fail(`Installed APK package ${appPackage} was not found by adb.`);
  }

  console.log(`adb device ready; ${appPackage} is installed.`);
} catch (error) {
  fail(error.stderr || error.message);
}
