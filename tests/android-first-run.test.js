const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const { prepareAndroidConfig } = require('../scripts/android-prepare-config');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function tempConfig(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caldaver-android-config-'));
  const configPath = path.join(dir, 'capacitor.config.json');
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}

function firstRunScript() {
  const html = read('web/public/index.html');
  const match = html.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/);
  assert.ok(match, 'missing Android first-run script');
  return match[1];
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.attributes = new Map();
    this.hidden = false;
    this.listeners = new Map();
    this.textContent = '';
    this.value = '';
    this.focused = false;
    this.disabled = false;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatchEvent(type) {
    const listener = this.listeners.get(type);
    assert.ok(listener, `missing ${type} listener for ${this.id}`);
    let defaultPrevented = false;
    listener({
      preventDefault() {
        defaultPrevented = true;
      }
    });
    return defaultPrevented;
  }

  focus() {
    this.focused = true;
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

async function loadFirstRunPage(savedUrl = '') {
  const elements = {
    server_url_setup: new FakeElement('server_url_setup'),
    startup_status: new FakeElement('startup_status'),
    server_url_form: new FakeElement('server_url_form'),
    server_url: new FakeElement('server_url'),
    server_url_error: new FakeElement('server_url_error'),
    server_url_submit: new FakeElement('server_url_submit')
  };
  elements.server_url_form.hidden = true;
  elements.server_url_error.hidden = true;

  const redirects = [];
  const store = new Map();
  if (savedUrl) {
    store.set('caldaver.android.serverUrl', savedUrl);
  }

  const context = {
    URL,
    document: {
      readyState: 'complete',
      addEventListener() {},
      getElementById(id) {
        return elements[id] || null;
      }
    },
    window: {
      localStorage: {
        getItem(key) {
          return store.has(key) ? store.get(key) : null;
        },
        removeItem(key) {
          store.delete(key);
        },
        setItem(key, value) {
          store.set(key, String(value));
        }
      },
      location: {
        replace(url) {
          redirects.push(url);
        }
      }
    }
  };

  vm.runInNewContext(firstRunScript(), context);
  await flushPromises();
  return { elements, redirects, store, setup: context.window.CaldaverAndroidServerSetup };
}

test('Android APK config preparation does not require build-time server URL env vars', () => {
  const configPath = tempConfig({
    appId: 'club.exampleapp.caldaver',
    server: {
      cleartext: true,
      url: 'https://old.example.test/',
      allowNavigation: ['old.example.test']
    }
  });

  const config = prepareAndroidConfig(configPath);
  const written = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  assert.equal(config.server.url, undefined);
  assert.equal(written.server.url, undefined);
  assert.equal(written.server.cleartext, false);
  assert.deepEqual(written.server.allowNavigation, ['*']);
});

test('Android APK config preparation ignores legacy server URL env vars', () => {
  const configPath = tempConfig({ appId: 'club.exampleapp.caldaver', server: { cleartext: false } });

  execFileSync(process.execPath, ['scripts/android-prepare-config.js'], {
    cwd: root,
    env: {
      ...process.env,
      CALDAVER_ANDROID_CONFIG_PATH: configPath,
      CALDAVER_ANDROID_SERVER_URL: 'https://env.example.test/',
      CALDAVER_BASE_URL: 'https://base.example.test/'
    }
  });

  const written = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(written.server.url, undefined);
  assert.equal(written.server.cleartext, false);
  assert.deepEqual(written.server.allowNavigation, ['*']);
});

test('Android first startup exposes an accessible instance URL setup form', () => {
  const html = read('web/public/index.html');

  assert.match(html, /id="server_url_setup"/);
  assert.match(html, /id="startup_status"[\s\S]*Checking saved instance/);
  assert.match(html, /id="server_url_form"[\s\S]*novalidate[\s\S]*hidden/);
  assert.match(html, /instance URL/);
  assert.match(html, /id="server_url"[\s\S]*type="url"[\s\S]*autocomplete="url"[\s\S]*enterkeyhint="go"[\s\S]*required/);
  assert.match(html, /id="server_url"[\s\S]*aria-describedby="server_url_help server_url_error"/);
  assert.match(html, /id="server_url_error"[\s\S]*role="alert"[\s\S]*aria-live="assertive"[\s\S]*hidden/);
  assert.match(html, /Open Caldaver/);
  assert.doesNotMatch(html, /Set CALDAVER_ANDROID_SERVER_URL|configured at build time/);
});

test('Android first-run setup reports invalid URLs accessibly without persisting them', async () => {
  const page = await loadFirstRunPage();
  page.elements.server_url.value = 'http://caldaver.example.test/';

  const defaultPrevented = page.elements.server_url_form.dispatchEvent('submit');

  assert.equal(defaultPrevented, true);
  assert.deepEqual(page.redirects, []);
  assert.equal(page.store.get(page.setup.storageKey), undefined);
  assert.equal(page.elements.server_url.getAttribute('aria-invalid'), 'true');
  assert.equal(page.elements.server_url_error.hidden, false);
  assert.match(page.elements.server_url_error.textContent, /HTTPS/);
  assert.equal(page.elements.server_url.focused, true);
});

test('Android first-run setup normalizes saves and opens a valid instance URL', async () => {
  const page = await loadFirstRunPage();
  page.elements.server_url.value = ' HTTPS://Example.COM/caldaver///#fragment ';

  const defaultPrevented = page.elements.server_url_form.dispatchEvent('submit');
  await flushPromises();

  assert.equal(defaultPrevented, true);
  assert.equal(page.store.get(page.setup.storageKey), 'https://example.com/caldaver');
  assert.deepEqual(page.redirects, ['https://example.com/caldaver']);
  assert.equal(page.elements.server_url.getAttribute('aria-invalid'), 'false');
  assert.equal(page.elements.server_url_error.hidden, true);
  assert.equal(page.elements.server_url_error.textContent, '');
});

test('Android startup uses a saved instance URL and skips setup on later launches', async () => {
  const page = await loadFirstRunPage('https://caldaver.example.test/team');

  assert.equal(page.elements.server_url_form.hidden, true);
  assert.equal(page.elements.startup_status.hidden, false);
  assert.equal(page.elements.server_url.focused, false);
  assert.deepEqual(page.redirects, ['https://caldaver.example.test/team']);
});

test('Android native plugin persists saved URLs in SharedPreferences', () => {
  const activity = read('android/app/src/main/java/club/exampleapp/caldaver/MainActivity.java');
  const plugin = read('android/app/src/main/java/club/exampleapp/caldaver/CaldaverInstancePlugin.java');

  assert.match(activity, /registerPlugin\(CaldaverInstancePlugin\.class\)/);
  assert.match(plugin, /@CapacitorPlugin\(name = "CaldaverInstance"\)/);
  assert.match(plugin, /getSharedPreferences\(PREFS_NAME, Context\.MODE_PRIVATE\)/);
  assert.match(plugin, /preferences\(\)\.edit\(\)\.putString\(PREF_SERVER_URL, normalized\)\.apply\(\)/);
  assert.match(plugin, /public void get\(PluginCall call\)/);
  assert.match(plugin, /public void set\(PluginCall call\)/);
  assert.match(plugin, /public void clearAndShowSetup\(PluginCall call\)/);
  assert.match(plugin, /!scheme\.equals\("https"\)/);
  assert.doesNotMatch(activity, /CALDAVER_ANDROID_SERVER_URL|CALDAVER_BASE_URL/);
  assert.doesNotMatch(plugin, /CALDAVER_ANDROID_SERVER_URL|CALDAVER_BASE_URL/);
});
