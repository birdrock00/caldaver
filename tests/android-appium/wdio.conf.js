const path = require('path');

const appiumHost = process.env.APPIUM_HOST || '127.0.0.1';
const appiumPort = Number(process.env.APPIUM_PORT || 4723);
const useExternalAppium = process.env.CALDAVER_ANDROID_EXTERNAL_APPIUM === '1';

const capability = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:deviceName': process.env.CALDAVER_ANDROID_DEVICE_NAME || 'Android',
  'appium:appPackage': process.env.CALDAVER_ANDROID_APP_PACKAGE || 'club.exampleapp.caldaver',
  'appium:appActivity': process.env.CALDAVER_ANDROID_APP_ACTIVITY || '.MainActivity',
  'appium:noReset': true,
  'appium:autoWebview': true,
  'appium:autoWebviewTimeout': Number(process.env.CALDAVER_ANDROID_WEBVIEW_TIMEOUT_MS || 30000),
  'appium:ensureWebviewsHavePages': true,
  'appium:newCommandTimeout': 120
};

if (process.env.ANDROID_UDID) {
  capability['appium:udid'] = process.env.ANDROID_UDID;
}

if (process.env.CALDAVER_ANDROID_PLATFORM_VERSION) {
  capability['appium:platformVersion'] = process.env.CALDAVER_ANDROID_PLATFORM_VERSION;
}

if (process.env.CALDAVER_ANDROID_SYSTEM_PORT) {
  capability['appium:systemPort'] = Number(process.env.CALDAVER_ANDROID_SYSTEM_PORT);
}

if (process.env.CALDAVER_ANDROID_CHROMEDRIVER_AUTODOWNLOAD === '1') {
  capability['appium:chromedriverAutodownload'] = true;
}

if (process.env.CALDAVER_ANDROID_CHROMEDRIVER_EXECUTABLE) {
  capability['appium:chromedriverExecutable'] = process.env.CALDAVER_ANDROID_CHROMEDRIVER_EXECUTABLE;
}

exports.config = {
  runner: 'local',
  specs: [path.join(__dirname, 'specs/**/*.spec.js')],
  maxInstances: 1,
  logLevel: process.env.WDIO_LOG_LEVEL || 'warn',
  bail: 0,
  hostname: appiumHost,
  port: appiumPort,
  path: '/',
  waitforTimeout: Number(process.env.CALDAVER_ANDROID_WAIT_MS || 30000),
  connectionRetryTimeout: 120000,
  connectionRetryCount: 1,
  services: useExternalAppium
    ? []
    : [[
      'appium',
      {
        command: process.env.APPIUM_BINARY || 'appium',
        args: {
          address: appiumHost,
          port: appiumPort
        }
      }
    ]],
  capabilities: [capability],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: Number(process.env.CALDAVER_ANDROID_MOCHA_TIMEOUT_MS || 180000)
  }
};
