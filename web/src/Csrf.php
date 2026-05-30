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

use Silex\Application;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Security\Csrf\CsrfToken;

class Csrf
{
    public static function check(Request $request, Application $app)
    {
        $app['monolog']->debug('Starting CSRF check');

        // This also generates a new CSRF token if not present
        $current_token = self::getCurrentToken($app);

        if ($request->getMethod() === 'GET') {
            return;
        }

        if (!$request->request->has('_token')) {
            $app['monolog']->debug('_token not found on request');
            if ($request->isXmlHttpRequest()) {
                return new JsonResponse([
                    'result' => 'ERROR',
                    'message' => 'CSRF token not present',
                ], 401);
            }
            $app->abort(401, 'CSRF token not present');
            return;
        }

        $csrf_provided_value = $request->request->get('_token');

        $token = new CsrfToken($app['csrf.secret'], $csrf_provided_value);

        $app['monolog']->debug('CSRF token sent by user', [
            'value' => $csrf_provided_value,
        ]);

        if (!$app['csrf.manager']->isTokenValid($token)) {
            $app['monolog']->debug('CSRF token is not valid. Aborting');
            if ($request->isXmlHttpRequest()) {
                return new JsonResponse([
                    'result' => 'ERROR',
                    'message' => 'Invalid CSRF token',
                ], 401);
            }
            $app->abort(401, 'Invalid CSRF token');
            return;
        }

        $app['monolog']->debug('CSRF token successfully validated');
        return;
    }

    /**
     * Returns current CSRF token
     *
     * @param \Silex\Application $app
     *
     * @return \Symfony\Component\Security\Csrf\CsrfToken
     */
    public static function getCurrentToken(Application $app)
    {
        return $app['csrf.manager']->getToken($app['csrf.secret']);
    }
}
