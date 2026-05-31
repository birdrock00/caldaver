#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReminderUnit {
    Months,
    Weeks,
    Days,
    Hours,
    Minutes,
}

impl ReminderUnit {
    pub fn from_input(value: &str) -> Self {
        match value {
            "months" => Self::Months,
            "weeks" => Self::Weeks,
            "days" => Self::Days,
            "hours" => Self::Hours,
            "minutes" => Self::Minutes,
            _ => Self::Minutes,
        }
    }

    pub fn as_input(&self) -> &'static str {
        match self {
            Self::Months => "months",
            Self::Weeks => "weeks",
            Self::Days => "days",
            Self::Hours => "hours",
            Self::Minutes => "minutes",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ReminderInterval {
    pub months: i64,
    pub days: i64,
    pub hours: i64,
    pub minutes: i64,
}

impl ReminderInterval {
    pub fn from_unit(count: i64, unit: ReminderUnit) -> Self {
        match unit {
            ReminderUnit::Months => Self {
                months: count,
                ..Self::default()
            },
            ReminderUnit::Weeks => Self {
                days: count * 7,
                ..Self::default()
            },
            ReminderUnit::Days => Self {
                days: count,
                ..Self::default()
            },
            ReminderUnit::Hours => Self {
                hours: count,
                ..Self::default()
            },
            ReminderUnit::Minutes => Self {
                minutes: count,
                ..Self::default()
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReminderInput<'a> {
    pub count: i64,
    pub unit: &'a str,
    pub position: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reminder {
    when: ReminderInterval,
    position: Option<usize>,
}

impl Reminder {
    pub fn new(when: ReminderInterval, position: Option<usize>) -> Self {
        Self { when, position }
    }

    pub fn create_from_input(input: ReminderInput<'_>) -> Self {
        Self::new(
            ReminderInterval::from_unit(input.count, ReminderUnit::from_input(input.unit)),
            input.position,
        )
    }

    pub fn create_from_trigger_parts(
        value_type: Option<&str>,
        related: Option<&str>,
        duration: ReminderInterval,
        duration_is_negative: bool,
        position: usize,
    ) -> Option<Self> {
        if value_type == Some("DATE-TIME") || related == Some("END") {
            return None;
        }

        if !duration_is_negative && count_minutes(duration) != 0 {
            return None;
        }

        Some(Self::new(duration, Some(position)))
    }

    pub fn parsed_when(&self) -> (i64, ReminderUnit) {
        let count_minutes = count_minutes(self.when);

        if count_minutes == 0 {
            return (0, ReminderUnit::Minutes);
        }

        for (unit, minutes) in [
            (ReminderUnit::Months, 40320),
            (ReminderUnit::Weeks, 10080),
            (ReminderUnit::Days, 1440),
            (ReminderUnit::Hours, 60),
            (ReminderUnit::Minutes, 1),
        ] {
            if count_minutes % minutes == 0 {
                return (count_minutes / minutes, unit);
            }
        }

        (99999, ReminderUnit::Months)
    }

    pub fn position(&self) -> Option<usize> {
        self.position
    }

    pub fn set_position(&mut self, position: Option<usize>) {
        self.position = position;
    }

    pub fn when(&self) -> ReminderInterval {
        self.when
    }

    pub fn iso8601_string(&self) -> String {
        let (mut count, unit) = self.parsed_when();

        match unit {
            ReminderUnit::Months => {
                count *= 28;
                format!("-P{count}D")
            }
            ReminderUnit::Weeks => {
                count *= 7;
                format!("-P{count}D")
            }
            ReminderUnit::Days => format!("-P{count}D"),
            ReminderUnit::Hours => format!("-PT{count}H"),
            ReminderUnit::Minutes => format!("-PT{count}M"),
        }
    }
}

pub fn count_minutes(interval: ReminderInterval) -> i64 {
    for (value, minutes) in [
        (interval.minutes, 1),
        (interval.hours, 60),
        (interval.days, 1440),
        (interval.months, 40320),
    ] {
        if value != 0 {
            return value * minutes;
        }
    }

    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_from_input() {
        let reminder = Reminder::create_from_input(ReminderInput {
            position: Some(2),
            count: 0,
            unit: "minutes",
        });

        assert_eq!(reminder.position(), Some(2));
        assert_eq!(
            reminder.when(),
            ReminderInterval {
                minutes: 0,
                ..ReminderInterval::default()
            }
        );

        let reminder = Reminder::create_from_input(ReminderInput {
            position: None,
            count: 3,
            unit: "hours",
        });

        assert_eq!(reminder.position(), None);
        assert_eq!(
            reminder.when(),
            ReminderInterval {
                hours: 3,
                ..ReminderInterval::default()
            }
        );
    }

    #[test]
    fn unknown_input_unit_defaults_to_minutes() {
        let reminder = Reminder::create_from_input(ReminderInput {
            position: None,
            count: 12,
            unit: "seconds",
        });

        assert_eq!(
            reminder.when(),
            ReminderInterval {
                minutes: 12,
                ..ReminderInterval::default()
            }
        );
    }

    #[test]
    fn parses_when_and_formats_iso8601() {
        for (interval, expected_parsed, expected_iso8601) in [
            (
                ReminderInterval {
                    minutes: 0,
                    ..ReminderInterval::default()
                },
                (0, ReminderUnit::Minutes),
                "-PT0M",
            ),
            (
                ReminderInterval {
                    minutes: 5,
                    ..ReminderInterval::default()
                },
                (5, ReminderUnit::Minutes),
                "-PT5M",
            ),
            (
                ReminderInterval {
                    hours: 5,
                    ..ReminderInterval::default()
                },
                (5, ReminderUnit::Hours),
                "-PT5H",
            ),
            (
                ReminderInterval {
                    minutes: 60,
                    ..ReminderInterval::default()
                },
                (1, ReminderUnit::Hours),
                "-PT1H",
            ),
            (
                ReminderInterval {
                    days: 28,
                    ..ReminderInterval::default()
                },
                (1, ReminderUnit::Months),
                "-P28D",
            ),
            (
                ReminderInterval {
                    days: 14,
                    ..ReminderInterval::default()
                },
                (2, ReminderUnit::Weeks),
                "-P14D",
            ),
        ] {
            let reminder = Reminder::new(interval, None);

            assert_eq!(reminder.parsed_when(), expected_parsed);
            assert_eq!(reminder.iso8601_string(), expected_iso8601);
        }
    }

    #[test]
    fn counts_first_non_zero_interval_component_in_legacy_order() {
        let interval = ReminderInterval {
            months: 1,
            days: 2,
            hours: 3,
            minutes: 4,
        };

        assert_eq!(count_minutes(interval), 4);
    }

    #[test]
    fn rejects_unsupported_trigger_parts() {
        let duration = ReminderInterval {
            minutes: 10,
            ..ReminderInterval::default()
        };

        assert_eq!(
            Reminder::create_from_trigger_parts(Some("DATE-TIME"), None, duration, true, 0),
            None
        );
        assert_eq!(
            Reminder::create_from_trigger_parts(None, Some("END"), duration, true, 0),
            None
        );
        assert_eq!(
            Reminder::create_from_trigger_parts(None, None, duration, false, 0),
            None
        );

        assert_eq!(
            Reminder::create_from_trigger_parts(None, None, duration, true, 3),
            Some(Reminder::new(duration, Some(3)))
        );
    }
}
