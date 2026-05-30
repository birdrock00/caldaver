<?php

namespace Caldaver\Event\Builder;

/*
 * Copyright (C) Jorge López Pérez <jorge@adobo.org>
 *
 *  This file is part of Caldaver.
 *
 *  Caldaver is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  any later version.
 *
 *  Caldaver is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with Caldaver.  If not, see <http://www.gnu.org/licenses/>.
 */

use Caldaver\Uuid;
use Caldaver\DateHelper;
use Caldaver\Event;
use Caldaver\Event\Builder;
use Caldaver\Event\VObjectEvent;
use Caldaver\Event\VObjectEventInstance;
use Caldaver\Event\RecurrenceId;
use Caldaver\Data\Reminder;
use Sabre\VObject\Component\VCalendar;

class VObjectBuilder implements Builder
{
    /** @var \DateTimeZone */
    protected $timezone;

    /**
     * Creates a new VObjectBuilder, specifying the user default timezone
     *
     * @param \DateTimeZone $timezone
     */
    public function __construct(\DateTimeZone $timezone)
    {
        $this->timezone = $timezone;
    }

    /**
     * Creates an empty Event object
     *
     * @param string $uid UID for this event
     * @return \Caldaver\Event
     */
    public function createEvent($uid)
    {
        $vcalendar = new VCalendar();

        $event = new VObjectEvent($vcalendar);
        $event->setUid($uid);

        return $event;
    }

    /**
     * Creates an empty EventInstance object
     *
     * @param \Caldaver\Event $event Event this instance will be attached to
     * @param \Caldaver\Event\RecurrenceId $recurrence_id
     * @return \Caldaver\EventInstance
     * @throws \LogicException If $event has no UID assigned
     */
    public function createEventInstanceFor(\Caldaver\Event $event, ?RecurrenceId $recurrence_id = null)
    {
        if ($recurrence_id === null) {
            return $event->createEventInstance();
        }

        return $event->getEventInstance($recurrence_id);
    }

    /**
     * Creates an EventInstance object after receiving an array of properties
     * with the following keys:
     *
     * summary
     * location
     * start_date
     * start_time
     * end_date
     * end_time
     * allday
     * description
     * class
     * transp
     * recurrence_id
     *
     * @param \Caldaver\Event $event Parent event
     * @param array $attributes
     * @return \Caldaver\EventInstance
     */
    public function createEventInstanceWithInput(\Caldaver\Event $event, array $attributes)
    {
        $recurrence_id = null;
        if ($event->isRecurrent() && isset($attributes['recurrence_id'])) {
            $recurrence_id = RecurrenceId::buildFromString($attributes['recurrence_id']);
        }
        $instance = $this->createEventInstanceFor($event, $recurrence_id);

        // Try to assign most simple properties
        foreach ($attributes as $key => $value) {
            $this->assignProperty($instance, $key, $value);
        }

        $this->setStartAndEnd($instance, $attributes);

        $reminders_input = isset($attributes['reminders']) ? $attributes['reminders'] : null;
        $this->setReminders($instance, $reminders_input);

        return $instance;
    }


    protected function assignProperty(VObjectEventInstance $instance, $key, $value)
    {
        switch ($key) {
            case 'summary':
                $instance->setSummary($value);
                break;
            case 'location':
                $instance->setLocation($value);
                break;
            case 'description':
                $instance->setDescription($value);
                break;
            case 'class':
                $instance->setClass($value);
                break;
            case 'transp':
                $instance->setTransp($value);
                break;
            case 'rrule':
                if (!$instance->isException()) {
                    $instance->setRepeatRule($value);
                }
                break;
        }
    }

    /**
     * Sets start and end on a VObjectEventInstance.
     *
     * @param \Caldaver\Event\VObjectEventInstance $instance
     * @param array $attributes Needs the following keys: 'allday', 'start' and 'end'
     */
    protected function setStartAndEnd(VObjectEventInstance $instance, array $attributes)
    {
        $is_all_day = !empty($attributes['allday']) && $attributes['allday'] === 'true';

        if ($is_all_day === true) {
            $utc = new \DateTimeZone('UTC');
            $start = DateHelper::frontEndToDateTime($attributes['start'], $utc);
            $end = DateHelper::frontEndToDateTime($attributes['end'], $utc);

            $end = $end->modify('+1 day');
        } else {
            $start = DateHelper::frontEndToDateTime($attributes['start'], $this->timezone);
            $end = DateHelper::frontEndToDateTime($attributes['end'], $this->timezone);
        }

        $instance->setStart($start, $is_all_day);
        $instance->setEnd($end, $is_all_day);
    }

    /**
     * Sets current instance reminders
     *
     * @param VObjectEventInstance $instance
     * @param array|null $reminders_input
     */
    protected function setReminders(VObjectEventInstance $instance, $reminders_input)
    {
        $reminders = [];

        if ($reminders_input !== null) {
            $reminders = $this->buildReminders($reminders_input);
        }

        $instance->clearReminders();
        foreach ($reminders as $reminder) {
            $instance->addReminder($reminder);
        }
    }

    /**
     * Returns a set of Reminder
     *
     * @param array $input In the form: [ 'unit' => [ ... ], 'count' => [ ... ] ]
     * @return \Caldaver\Data\Reminder[]
     */
    protected function buildReminders(Array $input)
    {
        $result = [];
        $total = count($input['unit']);

        for ($i=0;$i<$total;$i++) {
            $params = [
                'count' => $input['count'][$i],
                'unit' => $input['unit'][$i],
            ];

            $result[] = Reminder::createFromInput($params);
        }

        return $result;
    }
}
