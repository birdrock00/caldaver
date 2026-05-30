<?php
namespace Caldaver\Http;

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

use GuzzleHttp\Client as GuzzleClient;
use Caldaver\Http\Client;;
use Symfony\Component\HttpFoundation\Session\Session;

class ClientFactory
{
    public static function create(GuzzleClient $guzzle, Session $session, $auth_type)
    {
        $client = new Client($guzzle);
        if ($session->has('dav_username') && $session->has('dav_password')) {
            $client->setAuthentication(
                $session->get('dav_username'),
                $session->get('dav_password'),
                $auth_type
            );
        } elseif ($session->has('username') && $session->has('password')) {
            $client->setAuthentication(
                $session->get('username'),
                $session->get('password'),
                $auth_type
            );
        }

        return $client;
    }
}
