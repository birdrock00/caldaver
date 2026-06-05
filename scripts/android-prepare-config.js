#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const defaultConfigPath = path.join(repoRoot, 'android/app/src/main/assets/capacitor.config.json');

function prepareAndroidConfig(configPath = defaultConfigPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Capacitor Android config does not exist: ${configPath}`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.server = config.server || {};

  delete config.server.url;
  config.server.cleartext = false;
  config.server.allowNavigation = ['*'];

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, '\t')}\n`);
  return config;
}

if (require.main === module) {
  prepareAndroidConfig(process.env.CALDAVER_ANDROID_CONFIG_PATH || defaultConfigPath);
}

module.exports = {
  prepareAndroidConfig
};
