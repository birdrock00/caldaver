<?php

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

namespace Caldaver\Repositories;

use Caldaver\Data\Share;
use Caldaver\Data\Principal;
use Caldaver\CalDAV\Resource\Calendar;


/**
 * Interface for a shares repository
 *
 * @author Jorge López Pérez <jorge@adobo.org>
 */
interface SharesRepository
{
    /**
     * Returns all calendars shared with a user
     *
     * @param \Caldaver\Data\Principal $principal  User principal
     * @return \Caldaver\Data\Share[]
     */
    public function getSharesFor(Principal $principal);

    /**
     * Returns all grants that have been given to a calendar
     *
     * @param \Caldaver\CalDAV\Resource\Calendar $calendar
     * @return \Caldaver\Data\Share[]
     */
    public function getSharesOnCalendar(Calendar $calendar);

    /**
     * Stores a grant on the database
     *
     * @param \Caldaver\Data\Share $share  Share object
     */
    public function save(Share $share);

    /**
     * Removes a grant for a calendar
     *
     * @param \Caldaver\Data\Share $share  Share object
     */
    public function remove(Share $share);

    /**
     * Saves all calendar shares. Any other existing shares will get removed
     *
     * @param \Caldaver\CalDAV\Resource\Calendar $calendar
     */
    public function saveFromCalendar(Calendar $calendar);

    /**
     * Retrieves the Share object for a calendar which is shared with
     * a given principal
     *
     * @param \Caldaver\CalDAV\Resource\Calendar $calendar
     * @param \Caldaver\Data\Principal $principal  User principal
     */
    public function getSourceShare(Calendar $calendar, Principal $principal);
}
