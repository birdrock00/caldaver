<?php
namespace Caldaver;

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

use Caldaver\Repositories\SharesRepository;
use Caldaver\CalDAV\Client;
use Caldaver\CalDAV\Resource\Calendar;
use Caldaver\Data\Principal;
use Symfony\Component\HttpFoundation\Session\Session;

/**
 * This class is used to find all accessible calendars for an user
 */
class CalendarFinder
{
    /** @var boolean */
    protected $sharing_enabled;

    /** @var \Caldaver\CalDAV\Client */
    protected $client;

    /** @var \Caldaver\Repositories\SharesRepository */
    protected $shares_repository;

    /** @var \Symfony\Component\HttpFoundation\Session\Session */
    protected $session;

    /** @var \Caldaver\Data\Principal */
    protected $current_principal;

    /**
     * @param \Symfony\Component\HttpFoundation\Session\Session $session
     * @param \Caldaver\CalDAV\Client $client
     */
    public function __construct(Session $session, Client $client)
    {
        $this->sharing_enabled = false;
        $this->client = $client;
        $this->session = $session;
        $this->current_principal = new Principal($session->get('principal_url'));
    }

    /**
     * Sets the shares repository for this finder. Until it is called,
     * the finder disables all functionalities related to shared calendars
     *
     * @param \Caldaver\Repositories\SharesRepository $shares_repository
     */
    public function setSharesRepository(SharesRepository $shares_repository)
    {
        $this->sharing_enabled = true;
        $this->shares_repository = $shares_repository;
    }

    /**
     * Returns all calendars for the current user
     *
     * @return \Caldaver\CalDAV\Resource\Calendar[] Array of calendars
     */
    public function getCalendars()
    {
        $calendar_home_set = $this->session->get('calendar_home_set');

        $calendars = $this->client->getCalendars($calendar_home_set);
        foreach ($calendars as $calendar) {
            $calendar->setOwner($this->current_principal);
        }

        if ($this->sharing_enabled) {
            // Add share info to own calendars
            $this->addShares($calendars);

            // Also load calendars shared with current user
            $shared_calendars = $this->getCalendarSharedWith($this->current_principal);

            $calendars = array_merge($calendars, $shared_calendars);
        }

        return $calendars;
    }

    /**
     * Gets all calendars shared with current principal
     *
     * @param \Caldaver\Data\Principal $principal Principal
     * @return \Caldaver\CalDAV\Resource\Calendar[]
     */
    protected function getCalendarSharedWith(Principal $principal)
    {
        $result = [];

        $shares = $this->shares_repository->getSharesFor($principal);
        foreach ($shares as $share) {
            $calendar_url = $share->getCalendar();
            try {
                $calendar = $this->client->getCalendarByUrl($calendar_url);
                $share->applyCustomPropertiesTo($calendar);
            } catch (\Exception $e) {
                // ACL was probably removed or modified. Ignore this calendar
                // TODO: some logging
                continue;
            }

            $calendar->setWritable($share->isWritable());
            $owner_principal_url = $share->getOwner();
            $calendar->setOwner(new Principal($owner_principal_url));

            $custom_properties = $share->getProperties();
            $this->applySharedProperties($calendar, $custom_properties);

            $result[] = $calendar;
        }

        return $result;
    }

    /**
     * Applies custom properties to a calendar
     *
     * @param \Caldaver\CalDAV\Resource\Calendar $calendar
     * @param array $properties
     * @return void
     */
    protected function applySharedProperties(Calendar $calendar, array $properties)
    {
        // These are not real properties (with their XML namespace)
        foreach ($properties as $property => $value) {
            switch ($property) {
                case 'displayname':
                    $calendar->setProperty(Calendar::DISPLAYNAME, $value);
                    break;
                case 'color':
                    $calendar->setProperty(Calendar::COLOR, $value);
                    break;
                default:
                    // Ignore it
            }
        }
    }

    /**
     * Stores existing calendar shares inside each Calendar object
     *
     * @param \Caldaver\CalDAV\Resource\Calendar[] $calendars
     */
    protected function addShares(Array $calendars)
    {
        foreach ($calendars as $calendar) {
            $shares = $this->shares_repository->getSharesOnCalendar($calendar);
            $calendar->setShares($shares);
        }
    }
}
