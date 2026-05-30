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

use Caldaver\Event\RecurrenceId;

/**
 * Interface to generate new Events and EventInstances
 */

interface Builder
{
    /**
     * Creates an empty Event object
     *
     * @param string $uid UID for this event
     * @return \Caldaver\Event
     */
    public function createEvent($uid);

    /**
     * Creates an empty EventInstance object
     *
     * @param \Caldaver\Event $event Event this instance will be attached to
     * @param \Caldaver\Event\RecurrenceId $recurrence_id
     * @return \Caldaver\EventInstance
     * @throws \LogicException If $event has no UID assigned
     */
    public function createEventInstanceFor(\Caldaver\Event $event, ?RecurrenceId $recurrence_id = null);

    /**
     * Creates an EventInstance object after receiving an array of properties
     * with the following keys:
     *
     * summary
     * location
     * start
     * end
     * timezone
     * allday
     * rrule
     * description
     * class
     * transp
     * recurrence-id
     *
     * @param \Caldaver\Event $event Parent event
     * @param array $attributes
     * @return \Caldaver\EventInstance
     */
    public function createEventInstanceWithInput(\Caldaver\Event $event, array $attributes);
}
