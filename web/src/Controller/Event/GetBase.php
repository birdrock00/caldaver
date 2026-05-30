<?php

namespace Caldaver\Controller\Event;

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

use Caldaver\Controller\Event\Listing;
use Caldaver\CalDAV\Resource\Calendar;
use Caldaver\CalDAV\Resource\CalendarObject;
use Caldaver\DateHelper;
use Caldaver\Event\FullCalendarEvent;
use Caldaver\Data\Transformer\FullCalendarEventTransformer;
use Caldaver\Data\Serializer\PlainSerializer;;
use League\Fractal\Resource\Item;
use Silex\Application;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\ParameterBag;

class GetBase extends Listing
{
    public function __construct()
    {
        parent::__construct();
    }

    /**
     * Validates user input
     *
     * @param ParameterBag $input
     * @return bool
     */
    protected function validateInput(ParameterBag $input)
    {
        $fields = [
            'calendar',
            'uid',
            'timezone',
        ];

        foreach ($fields as $name) {
            if (empty($input->get($name))) {
                return false;
            }
        }

        return true;
    }

    public function execute(ParameterBag $input, Application $app)
    {
        $calendar = new Calendar($input->get('calendar'));
        $timezone = new \DateTimeZone($input->get('timezone'));
        $uid = $input->get('uid');

        $execution_fetch_start = microtime(true);
        $object = $this->client->fetchObjectByUid($calendar, $uid);
        $execution_fetch_end = microtime(true);

        $execution_parse_start = microtime(true);
        $fullcalendar_event = $this->buildFullCalendarEvent($calendar, $object);
        $execution_parse_end = microtime(true);

        $this->addPerformanceHeaders(
            $execution_fetch_end - $execution_fetch_start,
            $execution_parse_end - $execution_parse_start
        );

        return $this->serializeEvent($fullcalendar_event, $timezone, $app);
    }


    protected function buildFullCalendarEvent(Calendar $calendar, CalendarObject $object)
    {
        $result = [];

        $master_event = $object->getEvent();
        $base_instance = array($master_event->getEventInstance());
        $fullcalendar_events = FullCalendarEvent::generateFrom(
            $object,
            $calendar,
            $base_instance
        );

        $result = current($fullcalendar_events);

        return $result;
    }

    /**
     * Serialize a list of FullCalendar events using Fractal
     *
     * @param \Caldaver\Event\FullCalendarEvent $event FullCalendar event
     * @param \DateTimeZone $timezone Time zone the user has
     * @param \Silex\Application $app
     *
     * @return JsonResponse
     */
    protected function serializeEvent(FullCalendarEvent $event, \DateTimeZone $timezone, Application $app)
    {
        $fractal = $app['fractal'];
        $fractal->setSerializer(new PlainSerializer);
        $transformer = new FullCalendarEventTransformer($timezone);
        $item = new Item($event, $transformer);

        return new JsonResponse($fractal->createData($item)->toArray());
    }

    /**
     * Adds performance headers, that contain total fetch time and total parse time
     *
     * @param int $execution_fetch
     * @param int $execution_parse
     */
    protected function addPerformanceHeaders($execution_fetch, $execution_parse)
    {
        $total_fetch = sprintf('%.4F', $execution_fetch);
        $total_parse = sprintf('%.4F', $execution_parse);

        $this->addHeader("X-Fetch-Time", $total_fetch);
        $this->addHeader("X-Parse-Time", $total_parse);
    }

}
