<?php

namespace Caldaver\Event;

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

use Caldaver\Event;
use Caldaver\EventInstance;
use Caldaver\CalDAV\Resource\Calendar;
use Caldaver\CalDAV\Resource\CalendarObject;

/**
 * Represents an event that will be read by Fullcalendar
 */
class FullCalendarEvent
{
    /** @var string */
    protected $url;

    /** @var string */
    protected $etag;

    /** @var string */
    protected $calendar_url;

    /** @var \Caldaver\EventInstance */
    protected $event;

    /**
     * @param string $url
     * @param string $etag
     * @param string $calendar_url Calendar URL
     * @param \Caldaver\EventInstance $event Event instance
     */
    public function __construct($url, $etag, $calendar_url, EventInstance $event)
    {
        $this->url = $url;
        $this->etag = $etag;
        $this->calendar_url = $calendar_url;
        $this->event = $event;
    }


    /*
     * Getter for url
     */
    public function getUrl()
    {
        return $this->url;
    }

    /*
     * Getter for etag
     */
    public function getEtag()
    {
        return $this->etag;
    }


    /*
     * Getter for calendar_url
     */
    public function getCalendarUrl()
    {
        return $this->calendar_url;
    }

    /*
     * Getter for event
     */
    public function getEvent()
    {
        return $this->event;
    }

    /**
     * Generates an array of FullCalendarEvent that refer to a list of event
     * instances that come from a given CalendarObject and Calendar
     *
     * @param \Caldaver\CalDAV\Resource\CalendarObject $calendar_object
     * @param \Caldaver\CalDAV\Resource\Calendar $calendar
     * @param \Caldaver\EventInstance[] $instances
     * @return \Caldaver\Event\FullCalendarEvent[]
     */
    public static function generateFrom(
        CalendarObject $calendar_object,
        Calendar $calendar,
        Array $instances
    )
    {
        $result = [];
        $url = $calendar_object->getUrl();
        $etag = $calendar_object->getEtag();
        $calendar_url = $calendar->getUrl();

        foreach ($instances as $instance) {
            $result[] = new self($url, $etag, $calendar_url, $instance);
        }

        return $result;
    }
}

