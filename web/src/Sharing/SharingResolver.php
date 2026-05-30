<?php
namespace Caldaver\Sharing;

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
use Caldaver\Repositories\PrincipalsRepository;
use Caldaver\Data\Principal;
use Caldaver\Data\Share;
use Caldaver\CalDAV\Resource\Calendar;

/**
 * This is a service to retrieve shares and related principals. Also proxies a SharesRepository 
 */
class SharingResolver implements SharesRepository
{
    /** @var \Caldaver\Repositories\SharesRepository */
    protected $shares_repository;

    /** @var \Caldaver\Repositories\PrincipalsRepository */
    protected $principals_repository;

    /**
     * @param \Caldaver\Repositories\SharesRepository $shares_repository
     * @param \Caldaver\Repositories\PrincipalsRepository $principals_repository
     */
    public function __construct(
        SharesRepository $shares_repository,
        PrincipalsRepository $principals_repository
    )
    {
        $this->shares_repository = $shares_repository;
        $this->principals_repository = $principals_repository;
    }

    /**
     * Resolves principals for a list of shares
     *
     * @param \Caldaver\Data\Share[] $shares
     * @return void
     */
    public function resolveShares(array $shares)
    {
        foreach ($shares as $share) {
            $share_with = $share->getWith();
            $principal = $this->principals_repository->get($share_with);
            $share->setPrincipal($principal);
        }
    }

    /**
     * Returns all calendars shared with a user
     *
     * @param \Caldaver\Data\Principal $principal  User principal
     * @return \Caldaver\Data\Share[]
     */
    public function getSharesFor(Principal $principal)
    {
        $shares = $this->shares_repository->getSharesFor($principal);
        $this->resolveShares($shares);

        return $shares;
    }

    /**
     * Returns all grants that have been given to a calendar
     *
     * @param \Caldaver\CalDAV\Resource\Calendar $calendar
     * @return \Caldaver\Data\Share[]
     */
    public function getSharesOnCalendar(Calendar $calendar)
    {
        $shares = $this->shares_repository->getSharesOnCalendar($calendar);
        $this->resolveShares($shares);

        return $shares;
    }

    /**
     * Stores a grant on the database
     *
     * @param \Caldaver\Data\Share $share  Share object
     */
    public function save(Share $share)
    {
        $this->shares_repository->save($share);
    }

    /**
     * Removes a grant for a calendar
     *
     * @param \Caldaver\Data\Share $share  Share object
     */
    public function remove(Share $share)
    {
        $this->shares_repository->remove($share);
    }

    /**
     * Saves all calendar shares. Any other existing shares will get removed
     *
     * @param \Caldaver\CalDAV\Resource\Calendar $calendar
     */
    public function saveFromCalendar(Calendar $calendar)
    {
        $this->shares_repository->saveFromCalendar($calendar);
    }

    /**
     * Retrieves the Share object for a calendar which is shared with
     * a given principal
     *
     * @param \Caldaver\CalDAV\Resource\Calendar $calendar
     * @param \Caldaver\Data\Principal $principal  User principal
     */
    public function getSourceShare(Calendar $calendar, Principal $principal)
    {
        $share = $this->shares_repository->getSourceShare($calendar, $principal);
        $this->resolveShares([ $share ]);

        return $share;
    }
}
