<?php

use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Silex\Application;

use Caldaver\DateHelper;

// Authentication
$app->get('/login', '\Caldaver\Controller\Authentication::loginAction')->bind('login');
$app->post('/login', '\Caldaver\Controller\Authentication::loginAction');
$app->get('/logout', '\Caldaver\Controller\Authentication::logoutAction')->bind('logout');

// CSRF protection
$app->before(function(Request $request, Application $app) {
    return \Caldaver\Csrf::check($request, $app);
});


$controllers = $app['controllers_factory'];
$controllers->get('/', function () use ($app) {
    return $app['twig']->render('calendar.html');
})
->bind('calendar');

$controllers->get('/cards', '\Caldaver\Controller\Cards::indexAction')->bind('cards');
$controllers->get('/cards/list', '\Caldaver\Controller\Cards::listAction')->bind('cards.list');
$controllers->post('/cards/save', '\Caldaver\Controller\Cards::saveAction')->bind('cards.save');
$controllers->post('/cards/delete', '\Caldaver\Controller\Cards::deleteAction')->bind('cards.delete');

$controllers->get('/mail', '\Caldaver\Controller\Mail::indexAction')->bind('mail');
$controllers->get('/mail/accounts', '\Caldaver\Controller\Mail::accountsAction')->bind('mail.accounts');
$controllers->post('/mail/accounts/save', '\Caldaver\Controller\Mail::saveAccountAction')->bind('mail.accounts.save');
$controllers->get('/mail/read', '\Caldaver\Controller\Mail::readAction')->bind('mail.read');
$controllers->get('/mail/messages', '\Caldaver\Controller\Mail::messagesAction')->bind('mail.messages');
$controllers->get('/mail/messages/sync', '\Caldaver\Controller\Mail::syncMessagesAction')->bind('mail.messages.sync');
$controllers->get('/mail/message', '\Caldaver\Controller\Mail::messageAction')->bind('mail.message');
$controllers->post('/mail/message/unread', '\Caldaver\Controller\Mail::markUnreadAction')->bind('mail.message.unread');
$controllers->get('/mail/attachment', '\Caldaver\Controller\Mail::attachmentAction')->bind('mail.attachment');

$controllers->get('/preferences', '\Caldaver\Controller\Preferences::indexAction')->bind('preferences');
$controllers->post('/preferences', '\Caldaver\Controller\Preferences::saveAction')->bind('preferences.save');


$controllers->get('/calendars', '\Caldaver\Controller\Calendars\Listing::doAction')->bind('calendars.list');
$controllers->post('/calendars', '\Caldaver\Controller\Calendars\Create::doAction')->bind('calendar.create');
$controllers->post('/calendars/delete', '\Caldaver\Controller\Calendars\Delete::doAction')->bind('calendar.delete');
$controllers->post('/calendars/save', '\Caldaver\Controller\Calendars\Save::doAction')->bind('calendar.save');
$controllers->get('/events', '\Caldaver\Controller\Event\Listing::doAction')->bind('events.list');
$controllers->get('/eventbase', '\Caldaver\Controller\Event\GetBase::doAction')->bind('event.getBase');
$controllers->post('/events/drop', '\Caldaver\Controller\Event\Drop::doAction')->bind('event.drop');
$controllers->post('/events/resize', '\Caldaver\Controller\Event\Resize::doAction')->bind('event.resize');
$controllers->post('/events/delete', '\Caldaver\Controller\Event\Delete::doAction')->bind('event.delete');
$controllers->post('/events/save', '\Caldaver\Controller\Event\Save::doAction')->bind('event.save');

$controllers->get('/principals', '\Caldaver\Controller\Principals::search')->bind('principals.search');

// Dynamic JavaScript code
$controllers->get('/jssettings', '\Caldaver\Controller\JavaScriptCode::settingsAction')->bind('settings.js');

// Session keepalive
$controllers->get('/keepalive', function() { return ''; });

/**
 * Require being authenticated on every request. If authenticated, just load
 * current user preferences
 */
$controllers->before(function(Request $request, Silex\Application $app) {
    // If user is already authenticated, get his/her preferences and continue
    // processing the request
    if ($app['session']->has('username')) {
        $username = $app['session']->get('username');
        $preferences = $app['preferences.repository']->userPreferences($username);
        $app['user.preferences'] = $preferences;
        $app['user.timezone'] = $preferences->get('timezone');

        // Set application language
        $request->setLocale($preferences->get('language'));
        $app['translator']->setLocale($preferences->get('language'));
        return;
    }

    if (isset($app['auth.methods'])) {
        foreach ($app['auth.methods'] as $method) {
            if (call_user_func([$method, 'login'], $request, $app)) {
                return;
            }
        }
    }

    if ($request->isXmlHttpRequest()) {
        return new JsonResponse([], 401);
    } else {
        return new RedirectResponse($app['url_generator']->generate('login'));
    }
});

$app->mount('/', $controllers);


$app->error(function (\Exception $e, Request $request, $code) use ($app) {
    if ($app['debug']) {
        return;
    }

    // 404.html, or 40x.html, or 4xx.html, or error.html
    $templates = array(
        'errors/'.$code.'.html',
        'errors/'.substr($code, 0, 2).'x.html',
        'errors/'.substr($code, 0, 1).'xx.html',
        'errors/default.html',
    );

    return new Response(
        $app['twig']->resolveTemplate($templates)->render([
            'code' => $code,
            'message' => $e->getMessage(),
        ]),
        $code
    );
});
