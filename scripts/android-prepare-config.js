#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const configPath = path.join(repoRoot, 'android/app/src/main/assets/capacitor.config.json');
const serverURL = process.env.CALDAVER_ANDROID_SERVER_URL || process.env.CALDAVER_BASE_URL;
const extraNavigation = (process.env.CALDAVER_ANDROID_ALLOW_NAVIGATION || '')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean);

function hostnameFromURL(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}

if (!fs.existsSync(configPath)) {
  throw new Error(`Capacitor Android config does not exist: ${configPath}`);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.server = config.server || {};

if (serverURL) {
  config.server.url = serverURL;
}

const navigationHosts = new Set([
  ...(Array.isArray(config.server.allowNavigation) ? config.server.allowNavigation : []),
  ...extraNavigation
]);

const serverHost = hostnameFromURL(config.server.url);
if (serverHost) {
  navigationHosts.add(serverHost);
}

if (navigationHosts.size > 0) {
  config.server.allowNavigation = Array.from(navigationHosts).sort();
}

fs.writeFileSync(configPath, `${JSON.stringify(config, null, '\t')}\n`);
