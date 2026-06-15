/**
 * Functions used to manage the 'Repeat' tab interactions
 */

var CaldaverRepeat = CaldaverRepeat || {};

/**
 * Handles interaction with the form controls
 *
 * @param jQuery $form jQuery element containing the form
 */
CaldaverRepeat.handleForm = function handleForm($form) {
  var $fixed_repeat_rule = $('#fixed_repeat_rule');
  var $repeat_frequency = $('#repeat_frequency');
  var $repeat_ends = $('#repeat_ends');

  if ($fixed_repeat_rule.val() == 'true') {
    $form.find('select, input').attr('disabled', 'disabled');

    var original_rrule = RRule.fromString($('#rrule_original').val());
    $('#fixed_repeat_rule_explanation').html(CaldaverRepeat.explainRRule(original_rrule));
    return;
  }

  $form.on('change', 'input,select.secondary', function(e) {
    CaldaverRepeat.regenerate();
  });

  // [M-035] Repeat preset chip wiring. When a chip is tapped, set the
  // underlying frequency select, set the by-day checkboxes appropriately,
  // and trigger the change handlers. "Custom" just unhides the advanced
  // options without changing the current values.
  var presetMap = {
    'none':     { freq: -1, byday: [] },
    'daily':    { freq: RRule.DAILY, byday: [] },
    'weekdays': { freq: RRule.WEEKLY, byday: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] },
    'weekly':   { freq: RRule.WEEKLY, byday: [] },
    'monthly':  { freq: RRule.MONTHLY, byday: [] },
    'yearly':   { freq: RRule.YEARLY, byday: [] }
  };
  $form.on('click', '.repeat-preset', function() {
    var $chip = $(this);
    var kind = $chip.data('repeat-preset');
    if (!kind) {
      return;
    }
    if (kind === 'custom') {
      $form.find('.container_repeat_options').show();
      $chip.addClass('active').attr('aria-pressed', 'true').siblings().removeClass('active').attr('aria-pressed', 'false');
      return;
    }
    var preset = presetMap[kind];
    if (!preset) {
      return;
    }
    $repeat_frequency.val(String(preset.freq));
    // Reset by-day checkboxes
    $form.find('input[name="repeat_by_day"]').prop('checked', false);
    if (preset.byday && preset.byday.length) {
      for (var i = 0; i < preset.byday.length; i++) {
        $form.find('input[name="repeat_by_day"][value="' + preset.byday[i] + '"]').prop('checked', true);
      }
    }
    // Update active chip
    $chip.addClass('active').attr('aria-pressed', 'true').siblings().removeClass('active').attr('aria-pressed', 'false');
    // Trigger downstream change events
    $repeat_frequency.trigger('change');
    $repeat_ends.trigger('change');
  });
  // Pre-highlight the chip that matches the current value.
  setTimeout(function() {
    var currentFreq = parseInt($repeat_frequency.val());
    if (isNaN(currentFreq) || currentFreq === -1) {
      $form.find('.repeat-preset[data-repeat-preset="none"]').addClass('active').attr('aria-pressed', 'true');
    } else {
      $form.find('.repeat-preset[data-repeat-preset="custom"]').addClass('active').attr('aria-pressed', 'true');
    }
  }, 0);

  $repeat_frequency.on('change', function() {
    var new_frequency = $(this).val();
    var frequency = parseInt(new_frequency);

    if (frequency === -1 || new_frequency === 'keep-original') {
      $form.find('.container_repeat_options').hide();
    } else {
      $form.find('.container_repeat_options').show();
      CaldaverRepeat.showAllowedFieldsByFrequency(frequency);
    }

    $repeat_ends.trigger('change');
  });

  $repeat_ends.on('change', function() {
    var container_repeat_ends_options = $form.find('div.container_repeat_ends_options');
    var ends = $(this).val();

    if (ends === 'never') {
      container_repeat_ends_options.hide();
    }

    if (ends === 'after') {
      container_repeat_ends_options.show();
      $form.find('div.container_repeat_count').show();
      $form.find('div.container_repeat_until').hide();
      $form.find('input.repeat_until').val('');
    }

    if (ends === 'date') {
      container_repeat_ends_options.show();
      $form.find('div.container_repeat_count').hide();
      $form.find('div.container_repeat_until').show();
      $form.find('input.repeat_count').val('');
    }


    // Generate new RRULE value
    generate_iso8601_values($form); // Required to have a valid date

    // serialize* can't be called on a div
    var new_rrule = CaldaverRepeat.generateRRule(
        $form.find('input,select').serializeArray()
    );

    // Repeat was set to none
    if (new_rrule === null) {
      $('#rrule').val('');
      $('#repeat_explanation').html('');
      return;
    }

    $('#rrule').val(new_rrule.toString());
    $('#repeat_explanation').html(
        CaldaverRepeat.explainRRule(new_rrule)
      );
  });

  // Trigger it for the first time
  CaldaverRepeat.regenerate();
};

/**
 * Triggers a RRULE regeneration
 */
CaldaverRepeat.regenerate = function regenerate() {
    $('#repeat_frequency').trigger('change');
};


/**
 * Generates a RRule based on the form contents
 *
 * @param Object data Form data from serializeArray()
 * @return RRule|null Repeat rule, or null if recurrence is disabled
 */
CaldaverRepeat.generateRRule = function generateRRule(data) {
  var frequency = -1;
  var options = {};
  var ends;
  var by_day = [];

  // Used to keep the original RRULE, when Caldaver can't
  // reproduce the same RRULE
  var keep_original_rrule = false;

  $.each(data, function(i, field) {
    var value = field.value;

    if (value === '' || value === '-') {
      // Skip this one
      return true;
    }

    if (field.name === 'repeat_frequency') {

      // Unreproducible RRULE
      if (value === 'keep-original') {
        keep_original_rrule = true;
        return false;
      }

      value = parseInt(value);

      // Stop processing if repeat was not set
      if (value === -1) {
        return false;
      }

      frequency = value;
      options.freq = value;
    }

    if (field.name === 'repeat_by_day' && CaldaverRepeat.shouldConsider(frequency, field.name)) {
      by_day.push(CaldaverRepeat.getRRuleJsByDay(value));
    }

    if (field.name === 'repeat_by_month_day' && CaldaverRepeat.shouldConsider(frequency, field.name)) {
      options.bymonthday = value;
    }

    if (field.name === 'repeat_interval' && value !== '1') {
      options.interval = value;
    }

    if (field.name === 'repeat_ends') {
      ends = field.value;
    }

    if (field.name === 'repeat_count' && ends === 'after') {
      options.count = value;
    }

    if (field.name === 'repeat_until_date' && ends === 'date') {
      var is_all_day = $('input.allday').is(':checked');
      options.until = CaldaverRepeat.generateUntilDate(is_all_day);
      options.onlydate = is_all_day;
    }
  });

  if (by_day.length > 0) {
    options.byweekday = by_day;
  }

  // Special frequency value
  if (keep_original_rrule === true) {
    var rrule_original = RRule.fromString($('#rrule_original').val());
    return rrule_original;
  }

  // Empty RRULE?
  if (options.freq === undefined) {
    return null;
  }

  return new RRule(options);
};

/**
 * Translates a BYDAY value into a rrule.js byweekday constant
 *
 * @param string day form value
 * @return RRule constant
 */
CaldaverRepeat.getRRuleJsByDay = function getRRuleJsByDay(day) {
  if (day === 'sunday') {
    return RRule.SU;
  }

  if (day === 'monday') {
    return RRule.MO;
  }

  if (day === 'tuesday') {
    return RRule.TU;
  }

  if (day === 'wednesday') {
    return RRule.WE;
  }

  if (day === 'thursday') {
    return RRule.TH;
  }

  if (day === 'friday') {
    return RRule.FR;
  }

  if (day === 'saturday') {
    return RRule.SA;
  }
};

/**
 * Translates a BYDAY integer into its <option> value. Required when receiving
 * a built RRule
 *
 * @param int byday value
 * @return string
 */
CaldaverRepeat.getLabelForByDay = function gettLabelForByDay(day) {
  var days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  return days[day];
};

/**
 * Generates an human readable explanation of a RRULE
 *
 * @param RRule rrule
 */
CaldaverRepeat.explainRRule = function explainRRule(rrule) {
  return rrule.toText(rrule_gettext, CaldaverRepeat.language);
};

/**
 * Generates a list of day and month names to be used by rrule.js
 *
 * @return Object
 */
CaldaverRepeat.generateLanguage = function generateLanguage() {
  return {
    'dayNames': [
      CaldaverConf.i18n['labels.sunday'],
      CaldaverConf.i18n['labels.monday'],
      CaldaverConf.i18n['labels.tuesday'],
      CaldaverConf.i18n['labels.wednesday'],
      CaldaverConf.i18n['labels.thursday'],
      CaldaverConf.i18n['labels.friday'],
      CaldaverConf.i18n['labels.saturday']
    ],
    'monthNames': [
      CaldaverConf.i18n['labels.january'],
      CaldaverConf.i18n['labels.february'],
      CaldaverConf.i18n['labels.march'],
      CaldaverConf.i18n['labels.april'],
      CaldaverConf.i18n['labels.may'],
      CaldaverConf.i18n['labels.june'],
      CaldaverConf.i18n['labels.july'],
      CaldaverConf.i18n['labels.august'],
      CaldaverConf.i18n['labels.september'],
      CaldaverConf.i18n['labels.october'],
      CaldaverConf.i18n['labels.november'],
      CaldaverConf.i18n['labels.december'],
    ]
  };
};




/**
 * All frequency dependent fields
 */
CaldaverRepeat.allOptionalFields = [
  'repeat_by_day',
  'repeat_by_month_day'
];

/**
 * Returns allowed fields by frequency
 *
 * @param string frequency
 */
CaldaverRepeat.getFieldsForFrequency = function getFieldsForFrequency(frequency) {
  if (frequency === RRule.DAILY) {
    return ['repeat_by_day'];
  }

  if (frequency === RRule.WEEKLY) {
    return ['repeat_by_day'];
  }

  if (frequency === RRule.MONTHLY) {
    return ['repeat_by_month_day'];
  }

  if (frequency === RRule.YEARLY) {
    return [];
  }
};

/**
 * Shows allowed fields for a chosen frequency
 */
CaldaverRepeat.showAllowedFieldsByFrequency = function showAllowedFieldsByFrequency(frequency) {
  var total_fields = CaldaverRepeat.allOptionalFields.length;

  for (var i=0;i<total_fields;i++) {
    var current_field= CaldaverRepeat.allOptionalFields[i];

    if (CaldaverRepeat.shouldConsider(frequency, current_field)) {
      $('.container_' + current_field).show();
    } else {
      $('.container_' + current_field).hide();
    }
  }
};

/**
 * Checks if a field is allowed for a frequency
 *
 * @param string frequency
 * @param string field name
 */
CaldaverRepeat.shouldConsider = function shouldConsider(frequency, field) {
  var allowed = CaldaverRepeat.getFieldsForFrequency(frequency);

  if (allowed.indexOf(field) === -1) {
    return false;
  }

  return true;
};

/**
 * Modifies DOM to match a given RRULE
 *
 * @param string rrule
 * @param jQuery form
 */
CaldaverRepeat.setRepeatRuleOnForm = function setRepeatRuleOnForm(rrule, form) {
  var rrulejs = RRule.fromString(rrule);

  for (var param in rrulejs.origOptions) {
    var value = rrulejs.options[param];

    if (param === 'freq') {
      $('#repeat_frequency').val(value);
      continue;
    }

    if (param === 'interval') {
      $('#repeat_interval').val(value);
      continue;
    }

    if (param === 'count') {
      $('#repeat_count').val(value);
      $('#repeat_ends').val('after');
      continue;
    }

    if (param === 'until') {
      $('#repeat_until').datepicker('setDate', value);
      $('#repeat_ends').val('date');
      continue;
    }

    if (param === 'bymonthday') {
      $('#repeat_by_month_day').val(value);
      continue;
    }

    if (param === 'byweekday') {
      // RRule.js bug. Documentation states:
      //  Currently, rule.options.byweekday isn't equal to
      //  rule.origOptions.byweekday (which is an inconsistency).
      // This seems to happen for example when byweekday has a
      // "last X of month" format (e.g. -2MO)

      if (value === null) {
        value = rrulejs.origOptions[param];
      }
      for (var i=0;i<value.length;i++) {
        var label = CaldaverRepeat.getLabelForByDay(value[i]);
        form.find('.container_repeat_by_day [value=' + label + ']').prop('checked', true);
      }
      continue;
    }

    if (param === 'onlydate') {
      continue;
    }


    // Oops, unsupported property!
    // TODO
    console.log('Ooops, property ' + param + ' not supported');
  }

  CaldaverRepeat.regenerate();

  // Does this generated RRULE match the original one?
  var generated_rrule = RRule.fromString($('#rrule').val());
  var generated_description = generated_rrule.toText();
  var original_description = rrulejs.toText();

  if (generated_description !== original_description) {
    $('#repeat_frequency').prepend(
        '<option value="keep-original">'+ t('labels', 'keep_rrule') +'</option>'
    );
    $('#repeat_warning_rrule_unreproducible').show();
    $('#repeat_frequency').val('keep-original');
    CaldaverRepeat.regenerate();
  }
};


/**
 * Returns a date with the time from 'start time', suitable for the UNTIL parameter
 *
 * @param boolean is_allday
 * @return Date
 */

CaldaverRepeat.generateUntilDate = function generateUntilDate(is_allday) {
    if ($('#repeats_frequency').val() === '-1' || $('#repeat_ends').val() !== 'date') {
        return false;
    }

    var until_date = $('#repeat_until').datepicker('getDate');

    // Empty?
    if (until_date === null) {
        return false;
    }

    var result = moment(until_date);

    if (is_allday === false) {
        var start = moment($('#start').val());
        result.set('hour', start.get('hour'));
        result.set('minute', start.get('minute'));
        result.set('second', start.get('second'));
    }

    return result.toDate();
};

