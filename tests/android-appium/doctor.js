const { execFileSync } = require('child_process');

const adb = process.env.ADB_BINARY || 'adb';
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
