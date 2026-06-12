// native-bridge.js
//
// Native-mobile UX enhancements for the Caldaver Capacitor (Android) app.
//
// EVERYTHING in this file is guarded so that it is a COMPLETE no-op in a normal
// mobile/desktop browser, where `window.Capacitor` is undefined. The build
// globs assets/js/app/*.js, so this runs inside the Capacitor WebView too.
//
// Plugins are accessed defensively via window.Capacitor.Plugins (feature
// detection) instead of static imports, so if a given plugin is NOT installed
// the related enhancement silently does nothing. Installed at time of writing:
// @capacitor/core, @capacitor/android, @capacitor/dialog. StatusBar /
// SplashScreen / App / Haptics / Keyboard are accessed optimistically and
// degrade gracefully when absent.

(function () {
  'use strict';

  // Hard gate: only ever do anything on a real native platform.
  var Cap = window.Capacitor;
  if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) {
    return;
  }

  var Plugins = Cap.Plugins || {};

  function ready(fn) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      // Defer to next tick so the rest of the app can finish wiring up.
      setTimeout(fn, 0);
    } else {
      document.addEventListener('DOMContentLoaded', fn, false);
    }
  }

  // [E5] StatusBar: match the system status bar to the branded web theme.
  // Uses the StatusBar plugin if present; no-op otherwise.
  (function setupStatusBar() {
    var StatusBar = Plugins.StatusBar;
    if (!StatusBar) { return; }
    try {
      if (typeof StatusBar.setBackgroundColor === 'function') {
        StatusBar.setBackgroundColor({ color: '#1558b0' });
      }
      if (typeof StatusBar.setStyle === 'function') {
        // Light icons on the dark branded bar. Style.Dark == light content.
        StatusBar.setStyle({ style: 'DARK' });
      }
      if (typeof StatusBar.setOverlaysWebView === 'function') {
        StatusBar.setOverlaysWebView({ overlay: false });
      }
    } catch (e) { /* no-op on failure */ }
  })();

  // [E6] Android hardware BACK button: navigate web history back instead of
  // closing the app, and only exit when there is nowhere left to go back to.
  (function setupBackButton() {
    var App = Plugins.App;
    if (!App || typeof App.addListener !== 'function') { return; }
    try {
      App.addListener('backButton', function (ev) {
        var canGoBack = ev && typeof ev.canGoBack === 'boolean'
          ? ev.canGoBack
          : (window.history.length > 1);
        if (canGoBack) {
          window.history.back();
        } else if (typeof App.exitApp === 'function') {
          // At the root: let the user leave the app as expected.
          App.exitApp();
        }
      });
    } catch (e) { /* no-op on failure */ }
  })();

  // [E7] SplashScreen: hide the splash once the web app is ready so users are
  // never stuck staring at the launch image.
  (function setupSplashScreen() {
    var SplashScreen = Plugins.SplashScreen;
    if (!SplashScreen || typeof SplashScreen.hide !== 'function') { return; }
    ready(function () {
      try { SplashScreen.hide(); } catch (e) { /* no-op */ }
    });
  })();

  // [E8] Haptics: light tactile feedback on primary button taps. Delegated via
  // a single capture-phase listener; no-op when the Haptics plugin is absent.
  (function setupHaptics() {
    var Haptics = Plugins.Haptics;
    if (!Haptics) { return; }

    function tapImpact() {
      try {
        if (typeof Haptics.impact === 'function') {
          Haptics.impact({ style: 'LIGHT' });
        } else if (typeof Haptics.selectionStart === 'function') {
          Haptics.selectionStart();
        }
      } catch (e) { /* no-op */ }
    }

    function isPrimaryButton(el) {
      if (!el || !el.matches) { return false; }
      // Primary CTAs across the app: real buttons, submit inputs, and the
      // app's primary/CTA button classes.
      return el.matches(
        'button, [type="submit"], .btn-primary, .button-primary, .btn.primary, .cta'
      );
    }

    document.addEventListener('click', function (ev) {
      var node = ev.target;
      // Walk up a few levels in case the click lands on an inner element.
      for (var i = 0; node && i < 4; i++) {
        if (isPrimaryButton(node)) { tapImpact(); return; }
        node = node.parentElement;
      }
    }, true);
  })();

  // [E9] Keyboard: keep inputs visible when the soft keyboard opens and add a
  // body class so the web layout can react. Resize mode is also set in the
  // native manifest (adjustResize); this complements it. No-op without plugin.
  (function setupKeyboard() {
    var Keyboard = Plugins.Keyboard;
    if (!Keyboard) { return; }
    try {
      if (typeof Keyboard.setResizeMode === 'function') {
        Keyboard.setResizeMode({ mode: 'native' });
      }
      if (typeof Keyboard.setScroll === 'function') {
        Keyboard.setScroll({ isDisabled: false });
      }
      if (typeof Keyboard.addListener === 'function') {
        Keyboard.addListener('keyboardWillShow', function () {
          document.body && document.body.classList.add('keyboard-open');
        });
        Keyboard.addListener('keyboardWillHide', function () {
          document.body && document.body.classList.remove('keyboard-open');
          // Ensure the focused field is scrolled back into view.
          var active = document.activeElement;
          if (active && typeof active.scrollIntoView === 'function') {
            active.scrollIntoView({ block: 'nearest' });
          }
        });
      }
    } catch (e) { /* no-op on failure */ }
  })();

  // [E10] App state: when the app returns to the foreground, focus the document
  // so keyboard/focus state is sane after multitasking. No-op without plugin.
  (function setupAppState() {
    var App = Plugins.App;
    if (!App || typeof App.addListener !== 'function') { return; }
    try {
      App.addListener('appStateChange', function (state) {
        if (state && state.isActive && window.focus) {
          window.focus();
        }
      });
    } catch (e) { /* no-op on failure */ }
  })();

})();
