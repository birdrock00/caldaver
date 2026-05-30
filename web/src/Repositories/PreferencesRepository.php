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


/**
 * Interface for preferences retrieval
 *
 * @author Jorge López Pérez <jorge@adobo.org>
 */
interface PreferencesRepository
{
    /**
     * Gets all preferences for the given user
     *
     * @param string $username  User name
     * @return \Caldaver\Data\Preferences
     */
    public function userPreferences($username);

    /**
     * Saves user preferences
     *
     * @param string $username User name
     * @param \Caldaver\Data\Preferences $preferences
     */
    public function save($username, \Caldaver\Data\Preferences $preferences);

    /**
     * Sets a list of available preferences and their default value
     *
     * @param array $defaults key => default value
     * @return void
     */
    public function setDefaults(array $defaults);
}
