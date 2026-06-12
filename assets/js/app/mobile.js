/*
 * Caldaver mobile enhancements.
 *
 * This file is bundled after app.js (glob order: app.js, datetime.js, mobile.js).
 * By the time this runs the FullCalendar instance on #calendar_view is already
 * initialized by app.js. Everything here is guarded so that DESKTOP behavior is
 * completely unaffected: we only act on narrow / touch-capable viewports and we
 * reuse the existing global handlers / FullCalendar API rather than
 * reimplementing any calendar logic.
 *
 * Written in ES5-compatible style (var / function, jQuery) so uglifyjs -c -m can
 * parse it.
 */
(function() {
  'use strict';

  // ---------------------------------------------------------------------------
  // Helpers / feature detection
  // ---------------------------------------------------------------------------

  // Reuse app.js's viewport test when available, otherwise fall back to a local
  // media query so we never throw if load order ever changes.
  function isMobile() {
    if (typeof is_mobile_viewport === 'function') {
      return is_mobile_viewport();
    }
    if (window.matchMedia) {
      return window.matchMedia('(max-width: 900px)').matches;
    }
    return $(window).width() <= 900;
  }

  function isTouchCapable() {
    return ('ontouchstart' in window) ||
      (window.navigator && window.navigator.maxTouchPoints > 0);
  }

  // Should the mobile chrome be active at all? Either a narrow viewport or a
  // touch device that is reasonably narrow. Desktop (wide, no touch) => false.
  function mobileEnhancementsActive() {
    return isMobile() || (isTouchCapable() && $(window).width() <= 1024);
  }

  var $calendar = null;
  function calendar() {
    if ($calendar === null) {
      $calendar = $('#calendar_view');
    }
    return $calendar;
  }

  function calendarReady() {
    var $c = calendar();
    return $c.length > 0 && $c.data('fullCalendar') !== undefined;
  }

  // Safe wrapper around the FullCalendar API.
  function fc(method, arg1, arg2) {
    if (!calendarReady()) {
      return undefined;
    }
    try {
      if (arg2 !== undefined) {
        return calendar().fullCalendar(method, arg1, arg2);
      }
      if (arg1 !== undefined) {
        return calendar().fullCalendar(method, arg1);
      }
      return calendar().fullCalendar(method);
    } catch (e) {
      return undefined;
    }
  }

  // localStorage that never throws (private mode / Capacitor edge cases).
  function lsGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function lsSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) { /* ignore */ }
  }

  var VIEW_KEY = 'caldaver_mobile_view';
  // The list of views we cycle through on phones, in toggle order.
  var MOBILE_VIEWS = ['customizable_list', 'month', 'agendaDay'];

  // ---------------------------------------------------------------------------
  // [B8] Visual "haptic" tap feedback: toggle an .is-tapping class on press so
  // CSS can give an immediate active state on touch (mobile browsers otherwise
  // delay :active). Also fires the native Capacitor haptics plugin when present.
  // ---------------------------------------------------------------------------
  function addTapFeedback($el) {
    $el.on('touchstart', function() {
      $(this).addClass('is-tapping');
      try {
        var haptics = window.Capacitor &&
          window.Capacitor.Plugins &&
          window.Capacitor.Plugins.Haptics;
        if (haptics && typeof haptics.impact === 'function') {
          haptics.impact({ style: 'LIGHT' });
        }
      } catch (e) { /* ignore */ }
    });
    $el.on('touchend touchcancel blur', function() {
      $(this).removeClass('is-tapping');
    });
  }

  // ---------------------------------------------------------------------------
  // [B12] Debounce / double-tap guard. Wraps a handler so it cannot fire again
  // for `wait` ms, preventing accidental double-submit / rapid double-taps on
  // action buttons.
  // ---------------------------------------------------------------------------
  function debounceTap(fn, wait) {
    var locked = false;
    wait = wait || 450;
    return function(e) {
      if (locked) {
        if (e && e.preventDefault) { e.preventDefault(); }
        return;
      }
      locked = true;
      var self = this;
      var args = arguments;
      window.setTimeout(function() { locked = false; }, wait);
      return fn.apply(self, args);
    };
  }

  // ---------------------------------------------------------------------------
  // Action primitives -- all of these reuse existing app.js logic / the existing
  // FullCalendar instance instead of reimplementing anything.
  // ---------------------------------------------------------------------------

  // [B5] "Today" quick-jump, always reachable from the bottom bar.
  function goToday() {
    if (typeof mobile_calendar_previous_event_days !== 'undefined') {
      // Reset the mobile "previous events" expansion so Today is predictable.
      try { mobile_calendar_previous_event_days = 0; } catch (e) {}
    }
    fc('today');
  }

  function goPrev() {
    fc('prev');
  }

  function goNext() {
    fc('next');
  }

  // [B6] Refresh: reuse the exact reload path the existing refresh button uses.
  function refreshEvents() {
    if (typeof update_calendar_list === 'function') {
      update_calendar_list(true);
    } else {
      // Fallback: re-render whatever is loaded.
      fc('refetchEvents');
    }
  }

  // [B2] "New event": reuse the existing sidebar add button handler so behavior
  // is identical to desktop (default calendar, default duration, etc).
  function newEvent() {
    var $existing = $('#shortcut_add_event');
    if ($existing.length > 0 && !$existing.is('[disabled]')) {
      $existing.trigger('click');
      return;
    }
    // Fallback that mirrors #shortcut_add_event's own handler.
    if (typeof open_event_edit_dialog === 'function' && calendarReady()) {
      var start = fc('getDate');
      fc('unselect');
      open_event_edit_dialog({
        start: start,
        end: (typeof moment === 'function' && start) ? moment(start).add(1, 'hours') : undefined,
        allDay: false,
        view: 'month'
      });
    }
  }

  // ---------------------------------------------------------------------------
  // [B3 / B10] View toggling + remembering last-used mobile view.
  // On narrow screens app.js already defaults to the list view; we let the user
  // cycle through list / month / day, persist their choice and restore it.
  // ---------------------------------------------------------------------------
  function currentViewName() {
    var view = fc('getView');
    return (view && view.name) ? view.name : null;
  }

  function applyView(name) {
    if (!name || !calendarReady()) {
      return;
    }
    if (currentViewName() !== name) {
      fc('changeView', name);
    }
    lsSet(VIEW_KEY, name);
    updateViewButtonLabel(name);
  }

  function cycleView() {
    var current = currentViewName();
    var idx = -1;
    for (var i = 0; i < MOBILE_VIEWS.length; i++) {
      if (MOBILE_VIEWS[i] === current) { idx = i; break; }
    }
    var next = MOBILE_VIEWS[(idx + 1) % MOBILE_VIEWS.length];
    applyView(next);
  }

  function viewLabel(name) {
    var map = {
      'customizable_list': 'list',
      'month': 'month',
      'agendaWeek': 'week',
      'agendaDay': 'day'
    };
    var key = map[name] || 'view';
    if (typeof t === 'function') {
      var label = t('labels', key);
      if (label && label.indexOf('labels.') !== 0) {
        return label;
      }
    }
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  function updateViewButtonLabel(name) {
    var $label = $('#mobile_bottom_bar [data-mobile-action="view"] .mobile-bottom-btn-label');
    if ($label.length > 0) {
      $label.text(viewLabel(name || currentViewName()));
    }
  }

  function restoreSavedView() {
    var saved = lsGet(VIEW_KEY);
    if (!saved) {
      // Nothing saved yet: keep app.js's default, but record it for next time.
      updateViewButtonLabel(currentViewName());
      return;
    }
    // Only restore views we know are valid for mobile.
    var valid = false;
    for (var i = 0; i < MOBILE_VIEWS.length; i++) {
      if (MOBILE_VIEWS[i] === saved) { valid = true; break; }
    }
    if (valid) {
      applyView(saved);
    } else {
      updateViewButtonLabel(currentViewName());
    }
  }

  // ---------------------------------------------------------------------------
  // [B4] Bottom navigation / toolbar with big tap targets, mirroring the
  // existing Today / Prev / Next / View / Refresh actions.
  // ---------------------------------------------------------------------------
  function wireBottomBar() {
    var $bar = $('#mobile_bottom_bar');
    if ($bar.length === 0) {
      return;
    }
    $bar.prop('hidden', false).attr('aria-hidden', 'false');

    var handlers = {
      prev: goPrev,
      next: goNext,
      today: goToday,
      refresh: refreshEvents,
      view: cycleView
    };

    $bar.find('.mobile-bottom-btn').each(function() {
      var $btn = $(this);
      var action = $btn.attr('data-mobile-action');
      var handler = handlers[action];
      if (!handler) {
        return;
      }
      addTapFeedback($btn);
      // [B12] each action is debounced against rapid double taps.
      $btn.on('click', debounceTap(function(e) {
        e.preventDefault();
        handler();
      }, 400));
    });

    updateViewButtonLabel(currentViewName());
  }

  // ---------------------------------------------------------------------------
  // [B2] Floating action button for creating an event.
  // ---------------------------------------------------------------------------
  function wireFab() {
    var $fab = $('#mobile_fab_add');
    if ($fab.length === 0) {
      return;
    }
    $fab.prop('hidden', false);
    addTapFeedback($fab);
    $fab.on('click', debounceTap(function(e) {
      e.preventDefault();
      newEvent();
    }, 500));
  }

  // ---------------------------------------------------------------------------
  // [B1] Swipe left/right on the calendar to move to next/previous period.
  // Wires into the existing FullCalendar prev/next. Ignores mostly-vertical
  // gestures (so normal scrolling still works) and multi-touch.
  // ---------------------------------------------------------------------------
  function wireSwipe() {
    var $c = calendar();
    if ($c.length === 0) {
      return;
    }

    var startX = 0;
    var startY = 0;
    var tracking = false;
    var H_THRESHOLD = 60;   // min horizontal travel
    var V_TOLERANCE = 45;   // max vertical travel to still count as a swipe

    $c.on('touchstart', function(e) {
      var touches = e.originalEvent && e.originalEvent.touches;
      if (!touches || touches.length !== 1) {
        tracking = false;
        return;
      }
      tracking = true;
      startX = touches[0].clientX;
      startY = touches[0].clientY;
    });

    $c.on('touchend', function(e) {
      if (!tracking) {
        return;
      }
      tracking = false;
      var touches = e.originalEvent && e.originalEvent.changedTouches;
      if (!touches || touches.length !== 1) {
        return;
      }
      var dx = touches[0].clientX - startX;
      var dy = touches[0].clientY - startY;

      // Ignore vertical scrolls / diagonal drags.
      if (Math.abs(dx) < H_THRESHOLD || Math.abs(dy) > V_TOLERANCE) {
        return;
      }
      if (Math.abs(dx) < Math.abs(dy) * 1.5) {
        return;
      }

      if (dx < 0) {
        goNext();
      } else {
        goPrev();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // [B7] Make event taps reliably open the editor on touch. On some touch
  // devices a tap can be swallowed before FullCalendar's eventClick fires
  // (hover/qtip logic). app.js already routes mobile eventClick to
  // show_mobile_event_details; here we additionally make the whole list row /
  // event element keyboard- and tap-friendly and stop the tap from being
  // treated as a hover-only interaction.
  // ---------------------------------------------------------------------------
  function wireEventTaps() {
    var $c = calendar();
    if ($c.length === 0) {
      return;
    }
    // Prevent the 300ms "ghost click" / hover state from eating the first tap on
    // event elements: mark them touch-active so the subsequent click lands.
    $c.on('touchstart', '.fc-event, .fc-list-item', function() {
      $(this).addClass('is-tapping');
    });
    $c.on('touchend touchcancel', '.fc-event, .fc-list-item', function() {
      var $el = $(this);
      window.setTimeout(function() { $el.removeClass('is-tapping'); }, 150);
    });
  }

  // ---------------------------------------------------------------------------
  // [B11] Larger tap target to create an event on a day cell. In month view a
  // precise tap on a day background is fiddly on phones; we capture taps on the
  // day cell background and open the new-event dialog seeded with that day,
  // reusing open_event_edit_dialog (same path drag-select uses).
  // ---------------------------------------------------------------------------
  function wireDayCellTap() {
    var $c = calendar();
    if ($c.length === 0 || typeof open_event_edit_dialog !== 'function') {
      return;
    }

    $c.on('click', '.fc-day.fc-widget-content', debounceTap(function(e) {
      // Only in month view, and only when the tap wasn't on an event.
      if (currentViewName() !== 'month') {
        return;
      }
      if ($(e.target).closest('.fc-event, .fc-more, .fc-day-grid-event').length > 0) {
        return;
      }

      var dateStr = $(this).attr('data-date');
      if (!dateStr || typeof moment !== 'function') {
        return;
      }

      var start = moment(dateStr);
      fc('unselect');
      open_event_edit_dialog({
        start: start,
        end: moment(start).add(1, 'hours'),
        allDay: false,
        view: 'month'
      });
    }, 350));
  }

  // ---------------------------------------------------------------------------
  // [B9] Collapse the sidebar / calendar list into a toggling drawer on narrow
  // screens. We add a drawer toggle button (reusing app.js's set_sidebar_collapsed
  // so the calendar re-renders correctly) and a scrim that closes it.
  // ---------------------------------------------------------------------------
  function wireSidebarDrawer() {
    var $sidebar = $('#sidebar');
    if ($sidebar.length === 0) {
      return;
    }

    // Start collapsed on mobile.
    setSidebar(false);

    // Scrim behind the open drawer.
    var $scrim = $('#mobile_drawer_scrim');
    if ($scrim.length === 0) {
      $scrim = $('<div/>', {
        id: 'mobile_drawer_scrim',
        'class': 'mobile-drawer-scrim'
      }).appendTo('body');
      $scrim.on('click', function() { setSidebar(false); });
    }

    // Toggle button (floating, top-left) to open the calendar-list drawer.
    var $toggle = $('#mobile_drawer_toggle');
    if ($toggle.length === 0) {
      $toggle = $('<button/>', {
        type: 'button',
        id: 'mobile_drawer_toggle',
        'class': 'mobile-drawer-toggle',
        'aria-label': 'Calendars',
        title: 'Calendars'
      })
        .append('<i class="fa fa-list-ul" aria-hidden="true"></i>')
        .appendTo('body');
      addTapFeedback($toggle);
      $toggle.on('click', debounceTap(function(e) {
        e.preventDefault();
        setSidebar(!$('body').hasClass('mobile-drawer-open'));
      }, 300));
    }
  }

  function setSidebar(open) {
    var $sidebar = $('#sidebar');
    $sidebar.addClass('mobile-drawer');
    $('body').toggleClass('mobile-drawer-open', open);

    // The drawer's open/closed state is driven purely by the injected CSS
    // (body.mobile-drawer-open #sidebar). Clear any inline display app.js may
    // have set so the CSS rule wins.
    $sidebar.css('display', '');

    // Re-render FullCalendar after the layout change so it sizes correctly.
    if (open && calendarReady()) {
      window.setTimeout(function() { fc('render'); }, 0);
    }
  }

  // ---------------------------------------------------------------------------
  // [B6] Pull-to-refresh. When the user is at the top of the calendar/list and
  // drags downward past a threshold, trigger the same reload path as the
  // refresh button. A small indicator (#mobile_ptr) gives visual feedback.
  // ---------------------------------------------------------------------------
  function wirePullToRefresh() {
    var $c = calendar();
    var $ptr = $('#mobile_ptr');
    if ($c.length === 0 || $ptr.length === 0) {
      return;
    }

    var startY = 0;
    var pulling = false;
    var TRIGGER = 90;

    function scrollableTopReached() {
      // The FullCalendar scroller (list / agenda) or the window itself.
      var $scroller = $c.find('.fc-scroller').first();
      if ($scroller.length > 0) {
        return $scroller.scrollTop() <= 0;
      }
      return (window.pageYOffset || document.documentElement.scrollTop || 0) <= 0;
    }

    $c.on('touchstart', function(e) {
      var touches = e.originalEvent && e.originalEvent.touches;
      if (!touches || touches.length !== 1 || !scrollableTopReached()) {
        pulling = false;
        return;
      }
      pulling = true;
      startY = touches[0].clientY;
    });

    $c.on('touchmove', function(e) {
      if (!pulling) {
        return;
      }
      var touches = e.originalEvent && e.originalEvent.touches;
      if (!touches || touches.length !== 1) {
        return;
      }
      var dy = touches[0].clientY - startY;
      if (dy <= 0) {
        $ptr.prop('hidden', true).removeClass('mobile-ptr-armed');
        return;
      }
      var pull = Math.min(dy, TRIGGER + 40);
      $ptr
        .prop('hidden', false)
        .css('transform', 'translateX(-50%) translateY(' + (pull - 40) + 'px)')
        .toggleClass('mobile-ptr-armed', dy >= TRIGGER);
    });

    $c.on('touchend touchcancel', function() {
      if (!pulling) {
        return;
      }
      var armed = $ptr.hasClass('mobile-ptr-armed');
      pulling = false;
      $ptr
        .prop('hidden', true)
        .removeClass('mobile-ptr-armed')
        .css('transform', '');
      if (armed) {
        refreshEvents();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // [B13] Keep the bottom bar / FAB in sync with orientation & resize, and stay
  // out of the way of open dialogs (so the FAB doesn't cover dialog buttons).
  // ---------------------------------------------------------------------------
  function wireResponsiveChrome() {
    function sync() {
      var active = mobileEnhancementsActive();
      $('body').toggleClass('mobile-chrome-active', active);

      var dialogOpen = $('.ui-dialog:visible').length > 0 ||
        $('.mobile-event-details-open').length > 0 ||
        $('body').hasClass('mobile-event-details-open');

      $('#mobile_fab_add').toggleClass('mobile-hidden', dialogOpen || !active);
      $('#mobile_bottom_bar').toggleClass('mobile-hidden', dialogOpen || !active);
    }

    $(window).on('resize.mobilechrome orientationchange.mobilechrome', function() {
      window.setTimeout(sync, 50);
    });

    // Re-sync when dialogs open/close so the FAB hides under modals.
    $(document).on('dialogopen dialogclose', function() {
      window.setTimeout(sync, 0);
    });

    sync();
  }

  // ---------------------------------------------------------------------------
  // [B14] Inject the small CSS needed for the mobile chrome. Kept here (instead
  // of caldaver.less) so this enhancement is fully self-contained and touches
  // no other file. All selectors are mobile-scoped via body.mobile-chrome-active.
  // ---------------------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById('mobile_enhancements_css')) {
      return;
    }
    var css = [
      '.mobile-bottom-bar,.mobile-fab,.mobile-drawer-toggle,.mobile-ptr{display:none;}',
      'body.mobile-chrome-active .mobile-bottom-bar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:2400;',
        'background:#fff;border-top:1px solid #ddd;box-shadow:0 -2px 8px rgba(0,0,0,.12);',
        'padding:env(safe-area-inset-bottom,0) 0 0 0;}',
      'body.mobile-chrome-active .mobile-bottom-btn{flex:1 1 0;min-height:56px;border:0;background:transparent;',
        'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;',
        'font-size:11px;color:#444;padding:6px 2px;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
      'body.mobile-chrome-active .mobile-bottom-btn .fa{font-size:18px;}',
      'body.mobile-chrome-active .mobile-bottom-btn.is-tapping{background:rgba(51,103,214,.15);}',
      'body.mobile-chrome-active .mobile-bottom-btn:active{background:rgba(51,103,214,.15);}',
      'body.mobile-chrome-active .mobile-bottom-btn-label{line-height:1;}',
      'body.mobile-chrome-active #content{padding-bottom:64px;}',
      'body.mobile-chrome-active .mobile-fab{display:flex;align-items:center;justify-content:center;',
        'position:fixed;right:16px;bottom:72px;width:56px;height:56px;border-radius:50%;border:0;',
        'background:#3367d6;color:#fff;font-size:22px;z-index:2450;cursor:pointer;',
        'box-shadow:0 4px 12px rgba(0,0,0,.3);-webkit-tap-highlight-color:transparent;}',
      'body.mobile-chrome-active .mobile-fab.is-tapping{transform:scale(.92);background:#284f9e;}',
      'body.mobile-chrome-active .mobile-fab:active{transform:scale(.92);}',
      '.mobile-hidden{display:none!important;}',
      'body.mobile-chrome-active .mobile-drawer-toggle{display:flex;align-items:center;justify-content:center;',
        'position:fixed;left:12px;bottom:72px;width:44px;height:44px;border-radius:50%;border:0;',
        'background:#fff;color:#3367d6;font-size:18px;z-index:2450;cursor:pointer;',
        'box-shadow:0 2px 8px rgba(0,0,0,.25);-webkit-tap-highlight-color:transparent;}',
      'body.mobile-drawer-open .mobile-drawer-scrim{display:block;position:fixed;inset:0;',
        'background:rgba(0,0,0,.4);z-index:2500;}',
      'body.mobile-chrome-active.mobile-drawer-open #sidebar{display:block!important;position:fixed;',
        'top:0;left:0;bottom:0;width:84%;max-width:320px;z-index:2600;overflow-y:auto;background:#fff;',
        'box-shadow:2px 0 12px rgba(0,0,0,.3);}',
      'body.mobile-chrome-active .fc-event.is-tapping,body.mobile-chrome-active .fc-list-item.is-tapping{opacity:.6;}',
      'body.mobile-chrome-active .mobile-ptr{display:flex;align-items:center;justify-content:center;',
        'position:fixed;top:0;left:50%;transform:translateX(-50%);width:40px;height:40px;border-radius:50%;',
        'background:#fff;color:#3367d6;box-shadow:0 2px 6px rgba(0,0,0,.25);z-index:2550;}',
      'body.mobile-chrome-active .mobile-ptr.mobile-ptr-armed{color:#fff;background:#3367d6;}',
      'body.mobile-chrome-active .mobile-ptr.mobile-ptr-armed .fa{animation:mobileptrspin .8s linear infinite;}',
      '@keyframes mobileptrspin{to{transform:rotate(360deg);}}'
    ].join('');

    var style = document.createElement('style');
    style.id = 'mobile_enhancements_css';
    style.type = 'text/css';
    style.appendChild(document.createTextNode(css));
    (document.head || document.body).appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------
  function init() {
    // Only on the calendar page (the FAB/bar markup lives there).
    if ($('#calendar_view').length === 0) {
      return;
    }

    // Bail entirely on desktop so behavior is 100% unchanged there.
    if (!mobileEnhancementsActive()) {
      // Still inject styles + resize watcher so that if a desktop user shrinks
      // their window (or rotates a tablet) the chrome appears responsively.
      injectStyles();
      wireResponsiveChrome();
      return;
    }

    injectStyles();
    wireBottomBar();      // [B4]
    wireFab();            // [B2]
    wireSwipe();          // [B1]
    wireEventTaps();      // [B7]
    wireDayCellTap();     // [B11]
    wireSidebarDrawer();  // [B9]
    wirePullToRefresh();  // [B6]
    wireResponsiveChrome(); // [B13]

    // [B3/B10] restore the user's saved mobile view once FullCalendar is ready.
    if (calendarReady()) {
      restoreSavedView();
    } else {
      // FullCalendar not initialized yet -> retry a few times without throwing.
      var attempts = 0;
      var poll = window.setInterval(function() {
        attempts++;
        if (calendarReady()) {
          window.clearInterval(poll);
          restoreSavedView();
        } else if (attempts > 40) {
          window.clearInterval(poll);
        }
      }, 100);
    }
  }

  $(function() {
    try {
      init();
    } catch (e) {
      // Never break the page because of a mobile enhancement.
      if (window.console && window.console.error) {
        window.console.error('mobile.js init failed', e);
      }
    }
  });
})();
