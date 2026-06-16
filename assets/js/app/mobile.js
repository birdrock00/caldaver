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
        'font-size:12px;color:#444;padding:6px 2px;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
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
  // [M-002] Reflect the current page's primary section on <body
  // data-section="…">. The bottom tab bar uses this attribute to light up
  // the matching tab without needing each page to set it manually. We
  // resolve the section from the body class added by each page template
  // (caldaver-calendar-page, caldaver-cards-page, …) and fall back to the
  // first matching tab on the page.
  // ---------------------------------------------------------------------------
  function setBodySection() {
    if (!document.body) {
      return;
    }
    var section = null;
    var cls = document.body.className || '';
    var match = cls.match(/caldaver-([a-z]+)-page/);
    if (match && match[1]) {
      section = match[1];
    }
    if (!section) {
      var tab = document.querySelector('.caldaver-bottom-tab.active');
      if (tab && tab.dataset && tab.dataset.section) {
        section = tab.dataset.section;
      }
    }
    if (section) {
      document.body.setAttribute('data-section', section);
    }
  }

  // ---------------------------------------------------------------------------
  // [M-019] Toggle a body.calendar-empty class whenever the FullCalendar event
  // count drops to zero on a visible range. CSS renders the empty state.
  // ---------------------------------------------------------------------------
  function watchCalendarEmpty() {
    if (typeof $().fullCalendar !== 'function') {
      return;
    }
    var $c = calendar();
    if ($c.length === 0) {
      return;
    }
    var checkEmpty = function() {
      try {
        var events = $c.fullCalendar('clientEvents');
        var view = $c.fullCalendar('getView');
        var visible = false;
        if (view && typeof view.start !== 'undefined') {
          var start = moment(view.start);
          var end = moment(view.end);
          for (var i = 0; i < events.length; i++) {
            var e = events[i];
            if (!e || !e.start) {
              continue;
            }
            var estart = moment(e.start);
            var eend = e.end ? moment(e.end) : estart.clone();
            if (eend.isSameOrAfter(start) && estart.isSameOrBefore(end)) {
              visible = true;
              break;
            }
          }
        }
        document.body.classList.toggle('calendar-empty', !visible);
      } catch (err) {
        // FullCalendar may be re-rendering; skip this tick.
      }
    };
    $c.on('eventAfterAllRender.calempty', checkEmpty);
    $c.on('viewDisplay.calempty', checkEmpty);
    checkEmpty();
  }

  // ---------------------------------------------------------------------------
  // [M-020] Quick filter chips above the calendar. Tap to jump to the
  // corresponding date range and switch to the appropriate view.
  // ---------------------------------------------------------------------------
  function wireQuickChips() {
    var $chips = $('.calendar-quick-chip');
    if ($chips.length === 0) {
      return;
    }
    $chips.each(function() {
      var $chip = $(this);
      $chip.on('click', function() {
        var kind = $chip.data('quick');
        if (!kind || typeof moment === 'undefined' || !calendarReady()) {
          return;
        }
        var now = moment();
        var target = null;
        var view = null;
        if (kind === 'today') {
          target = now.clone();
          view = 'customizable_list';
        } else if (kind === 'tomorrow') {
          target = now.clone().add(1, 'day').startOf('day');
          view = 'agendaDay';
        } else if (kind === 'week') {
          target = now.clone().startOf('week');
          view = 'agendaWeek';
        } else if (kind === 'next-week') {
          target = now.clone().add(1, 'week').startOf('week');
          view = 'agendaWeek';
        } else if (kind === 'month') {
          target = now.clone().startOf('month');
          view = 'month';
        }
        if (target) {
          fc('gotoDate', target.toDate());
        }
        if (view) {
          applyView(view);
        }
        $chips.removeClass('active').attr('aria-selected', 'false');
        $chip.addClass('active').attr('aria-selected', 'true');
      });
    });
  }

  // ---------------------------------------------------------------------------
  // [M-015] Set the FullCalendar event colour as a CSS custom property so the
  // mobile event-chip CSS can paint the 4 px left bar in the calendar colour.
  // Also adds the M-016 inline icons (location / video / attendees) when the
  // event has the corresponding property.
  // ---------------------------------------------------------------------------
  function decorateEvents() {
    if (!calendarReady()) {
      return;
    }
    try {
      var events = calendar().fullCalendar('clientEvents');
      for (var i = 0; i < events.length; i++) {
        var e = events[i];
        if (!e) {
          continue;
        }
        // Stash the colour as a CSS custom property on the event element.
        var colour = e.color || (e.source && e.source.color) || '#3367d6';
        if (e._caldaverColor !== colour) {
          e._caldaverColor = colour;
        }
      }
    } catch (err) { /* ignore */ }
  }
  function applyEventDecoration() {
    if (!calendarReady()) {
      return;
    }
    var $c = calendar();
    $c.find('.fc-event, .fc-list-item').each(function() {
      var $el = $(this);
      var id = $el.data('event') && $el.data('event').id;
      var fcEvent = null;
      if (id !== undefined) {
        try {
          fcEvent = $c.fullCalendar('clientEvents', id)[0];
        } catch (e) { /* ignore */ }
      }
      var colour = (fcEvent && (fcEvent.color || (fcEvent.source && fcEvent.source.color))) || '#3367d6';
      $el.css({
        '--caldaver-fc-event-color': colour,
        'border-left': '4px solid ' + colour,
        'background-color': ''
      });
      // M-016 inline icons
      if (!$el.find('.fc-event-icon').length) {
        var $icons = $('<span class="fc-event-icon" aria-hidden="true"></span>');
        if (fcEvent) {
          if (fcEvent.location) {
            $icons.append('<i class="fa fa-map-marker" title="Location"></i> ');
          }
          if (fcEvent.url) {
            $icons.append('<i class="fa fa-video-camera" title="Video"></i> ');
          }
          if (fcEvent.attendees && fcEvent.attendees.length) {
            $icons.append('<i class="fa fa-users" title="Attendees"></i> ');
          }
        }
        $el.find('.fc-content, .fc-list-item-title').first().append($icons);
      }
    });
  }
  function watchEventDecoration() {
    if (!calendarReady()) {
      return;
    }
    var $c = calendar();
    $c.on('eventAfterRender.caldaverEvent', applyEventDecoration);
    $c.on('eventDestroy.caldaverEvent', applyEventDecoration);
    $c.on('viewDisplay.caldaverEvent', applyEventDecoration);
    decorateEvents();
    applyEventDecoration();
  }

  // ---------------------------------------------------------------------------
  // [M-018] Slide-and-fade on period changes. Toggle a class on the calendar
  // root that animates the next paint. Honours `prefers-reduced-motion` and
  // html[data-reduce-motion="true"].
  // ---------------------------------------------------------------------------
  function animatePeriodChange(direction) {
    if (document.documentElement.getAttribute('data-reduce-motion') === 'true') {
      return;
    }
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    var $c = calendar();
    if ($c.length === 0) {
      return;
    }
    var cls = direction === 'next'
      ? 'calendar--sliding-left'
      : 'calendar--sliding-right';
    $c.removeClass('calendar--sliding-left calendar--sliding-right').addClass(cls);
    window.setTimeout(function() {
      $c.removeClass(cls);
    }, 280);
  }

  // Wrap the existing goPrev/goNext so the animation piggybacks.
  var _origGoPrev = goPrev;
  var _origGoNext = goNext;
  goPrev = function() {
    animatePeriodChange('prev');
    return _origGoPrev();
  };
  goNext = function() {
    animatePeriodChange('next');
    return _origGoNext();
  };

  // ---------------------------------------------------------------------------
  // [M-002] Bottom tab bar wiring. We add the .caldaver-ripple-host class so
  // CSS adds the press feedback. Already the active class is set server-side
  // by the Twig template; we just need to make sure taps are debounced.
  // ---------------------------------------------------------------------------
  function wireBottomTabs() {
    var $tabs = $('.caldaver-bottom-tabs .caldaver-bottom-tab');
    if ($tabs.length === 0) {
      return;
    }
    $tabs.each(function() {
      var $tab = $(this);
      $tab.addClass('caldaver-ripple-host');
      addTapFeedback($tab);
    });
  }

  // ---------------------------------------------------------------------------
  // [M-138] Generalized pull-to-refresh. Looks for [data-pull-refresh] on a
  // container and triggers a refresh callback (data attribute or by id).
  // ---------------------------------------------------------------------------
  function wirePullToRefreshGeneric() {
    var nodes = document.querySelectorAll('[data-pull-refresh]');
    if (nodes.length === 0) {
      return;
    }
    for (var i = 0; i < nodes.length; i++) {
      wireSinglePtr(nodes[i]);
    }
  }
  function wireSinglePtr(container) {
    var startY = 0;
    var pulling = false;
    var TRIGGER = 90;
    function topReached() {
      var el = container;
      // Walk up looking for a scrollable parent.
      while (el && el !== document.body) {
        if (el.scrollTop > 0) {
          return false;
        }
        el = el.parentElement;
      }
      return (window.pageYOffset || document.documentElement.scrollTop || 0) <= 0;
    }
    function onStart(e) {
      var touches = e.touches;
      if (!touches || touches.length !== 1 || !topReached()) {
        pulling = false;
        return;
      }
      pulling = true;
      startY = touches[0].clientY;
    }
    function onMove(e) {
      if (!pulling) {
        return;
      }
      var touches = e.touches;
      if (!touches || touches.length !== 1) {
        return;
      }
      var dy = touches[0].clientY - startY;
      if (dy <= 0) {
        return;
      }
      e.preventDefault && e.preventDefault();
    }
    function onEnd() {
      if (!pulling) {
        return;
      }
      pulling = false;
      triggerRefresh(container);
    }
    function triggerRefresh(c) {
      var id = c.id;
      if (!id) {
        return;
      }
      // The page's existing refresh button works in every case; we just
      // simulate a click on it. This avoids re-implementing the data load.
      var btn = document.getElementById(id.replace(/_panel$|_shell$|_content$/, '_refresh'));
      if (btn) {
        btn.click();
      } else {
        // For preferences and others, look for any refresh button.
        btn = c.querySelector('button[id$="_refresh"]');
        if (btn) {
          btn.click();
        }
      }
    }
    container.addEventListener('touchstart', onStart, { passive: true });
    container.addEventListener('touchmove', onMove, { passive: false });
    container.addEventListener('touchend', onEnd, { passive: true });
  }

  // ---------------------------------------------------------------------------
  // [M-070 / M-072 / M-078] Bottom sheet helper. Renders a panel of buttons
  // and closes on scrim tap or after a choice.
  // ---------------------------------------------------------------------------
  function openBottomSheet(panelEl) {
    var scrim = document.createElement('div');
    scrim.className = 'mobile-reply-scrim';
    scrim.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2690;';
    scrim.addEventListener('click', function() {
      closeBottomSheet(panelEl, scrim);
    });
    document.body.appendChild(scrim);
    document.body.appendChild(panelEl);
    document.body.classList.add('mobile-bottom-sheet-open');
  }
  function closeBottomSheet(panelEl, scrim) {
    if (panelEl && panelEl.parentNode) {
      panelEl.parentNode.removeChild(panelEl);
    }
    if (scrim && scrim.parentNode) {
      scrim.parentNode.removeChild(scrim);
    }
    document.body.classList.remove('mobile-bottom-sheet-open');
  }

  // ---------------------------------------------------------------------------
  // [M-261] About / Version modal. Reads version + commit info from the page
  // (C CaldaverConf, if present) and renders a simple modal.
  // ---------------------------------------------------------------------------
  function wireAboutTrigger() {
    var btn = document.querySelector('[data-caldaver-about-trigger]');
    if (!btn) {
      return;
    }
    btn.addEventListener('click', function() {
      var conf = window.CaldaverConf || {};
      var version = (conf.version || 'unknown');
      var commit = (conf.commit || 'dev');
      var buildDate = (conf.build_date || '');
      var panel = document.createElement('div');
      panel.className = 'mail-reply-sheet';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-labelledby', 'caldaver-about-title');
      panel.innerHTML = [
        '<div class="mail-reply-sheet-panel" role="document">',
        '  <h2 id="caldaver-about-title" style="margin:0 0 4px;font-size:17px;">Caldaver</h2>',
        '  <p style="margin:0;font-size:13px;color:var(--caldaver-color-text-muted);">Version ' + escapeHtml(version) + '</p>',
        '  <p style="margin:0;font-size:13px;color:var(--caldaver-color-text-muted);">Commit ' + escapeHtml(commit) + (buildDate ? ' &middot; built ' + escapeHtml(buildDate) : '') + '</p>',
        '  <a href="https://github.com/caldaver-app/caldaver" target="_blank" rel="noopener">github.com/caldaver-app/caldaver</a>',
        '  <button type="button" class="cancel" id="caldaver-about-close">Close</button>',
        '</div>'
      ].join('');
      var scrim = panel; // reuse the panel's own background scrim
      var scrimEl = document.createElement('div');
      scrimEl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2680;';
      scrimEl.addEventListener('click', function() {
        closeBottomSheet(panel, scrimEl);
      });
      document.body.appendChild(scrimEl);
      document.body.appendChild(panel);
      panel.querySelector('#caldaver-about-close').addEventListener('click', function() {
        closeBottomSheet(panel, scrimEl);
      });
    });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // ---------------------------------------------------------------------------
  // [M-091] Recent searches (localStorage). Tracked per scope (contacts, mail).
  // ---------------------------------------------------------------------------
  var RECENT_KEY = 'caldaver.recent_searches';
  function recentSearches(scope) {
    try {
      var raw = window.localStorage.getItem(RECENT_KEY);
      var all = raw ? JSON.parse(raw) : {};
      return all[scope] || [];
    } catch (e) {
      return [];
    }
  }
  function recordRecentSearch(scope, term) {
    term = String(term || '').trim();
    if (!term) {
      return;
    }
    try {
      var raw = window.localStorage.getItem(RECENT_KEY);
      var all = raw ? JSON.parse(raw) : {};
      var list = (all[scope] || []).filter(function(t) { return t !== term; });
      list.unshift(term);
      all[scope] = list.slice(0, 5);
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(all));
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // [M-132] Reduce-motion preference toggle (client-side only).
  // ---------------------------------------------------------------------------
  function wireReduceMotionToggle() {
    var cb = document.getElementById('pref_reduce_motion');
    if (!cb) {
      return;
    }
    try {
      var cur = window.localStorage.getItem('caldaver.reduce_motion') === 'true'
        || document.documentElement.getAttribute('data-reduce-motion') === 'true';
      cb.checked = cur;
    } catch (e) { /* ignore */ }
    cb.addEventListener('change', function() {
      try {
        if (cb.checked) {
          window.localStorage.setItem('caldaver.reduce_motion', 'true');
          document.documentElement.setAttribute('data-reduce-motion', 'true');
        } else {
          window.localStorage.removeItem('caldaver.reduce_motion');
          document.documentElement.removeAttribute('data-reduce-motion');
        }
      } catch (e) { /* ignore */ }
    });
  }

  // ---------------------------------------------------------------------------
  // [M-270] Storage used indicator. Uses navigator.storage.estimate() if
  // available; otherwise falls back to a "Storage info unavailable" message.
  // ---------------------------------------------------------------------------
  function wireStorageUsed() {
    var el = document.getElementById('pref_storage_used');
    if (!el) {
      return;
    }
    if (!navigator.storage || typeof navigator.storage.estimate !== 'function') {
      el.textContent = 'Storage info unavailable in this browser.';
      return;
    }
    navigator.storage.estimate().then(function(est) {
      var used = (est.usage || 0);
      var quota = (est.quota || 0);
      var fmt = function(b) {
        if (b < 1024) return b + ' B';
        if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
        if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
        return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
      };
      el.textContent = 'Storage used: ' + fmt(used) + (quota ? ' of ' + fmt(quota) : '');
    }).catch(function() {
      el.textContent = 'Storage info unavailable.';
    });
  }

  // ---------------------------------------------------------------------------
  // [M-161] Generic skeleton rows. Page templates ship the markup; this
  // function replaces any .skeleton-row spans inside [data-pull-refresh] or
  // #contacts_loading with a few extra rows for visual variety.
  // ---------------------------------------------------------------------------
  function expandSkeletons() {
    var containers = document.querySelectorAll('#contacts_loading, .mail-loading-state, .prefs-section .skeleton-stack');
    for (var i = 0; i < containers.length; i++) {
      var c = containers[i];
      if (c.querySelectorAll('.skeleton-row').length > 1) {
        continue;
      }
      for (var j = 0; j < 3; j++) {
        var row = document.createElement('div');
        row.className = 'skeleton skeleton-row';
        c.appendChild(row);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------
  function init() {
    // Common (every page) wiring.
    setBodySection();
    wireBottomTabs();
    wirePullToRefreshGeneric();
    wireAboutTrigger();
    wireReduceMotionToggle();
    wireStorageUsed();
    expandSkeletons();

    // Calendar-only wiring.
    if ($('#calendar_view').length === 0) {
      // Still inject styles + resize watcher so responsive chrome adapts.
      injectStyles();
      wireResponsiveChrome();
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
    wireQuickChips();     // [M-020]
    watchCalendarEmpty(); // [M-019]
    wireResponsiveChrome(); // [B13]

    // [B3/B10 / M-015 / M-018] restore the user's saved mobile view once
    // FullCalendar is ready, then start watching event rendering.
    if (calendarReady()) {
      restoreSavedView();
      watchEventDecoration();
    } else {
      // FullCalendar not initialized yet -> retry a few times without throwing.
      var attempts = 0;
      var poll = window.setInterval(function() {
        attempts++;
        if (calendarReady()) {
          window.clearInterval(poll);
          restoreSavedView();
          watchEventDecoration();
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
