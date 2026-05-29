<?php
namespace AgenDAV\Controller;

use Silex\Application;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

class Mail
{
    public function indexAction(Request $request, Application $app)
    {
        return $app['twig']->render('mail.html');
    }

    public function accountsAction(Request $request, Application $app)
    {
        return new JsonResponse([
            'data' => $app['mail.accounts']->findForOwner($app['session']->get('username')),
        ]);
    }

    public function saveAccountAction(Request $request, Application $app)
    {
        $input = [
            'id' => trim($request->request->get('id', '')),
            'label' => trim($request->request->get('label', '')),
            'email_address' => trim($request->request->get('email_address', '')),
            'imap_host' => trim($request->request->get('imap_host', '')),
            'imap_port' => trim($request->request->get('imap_port', '993')),
            'encryption' => trim($request->request->get('encryption', 'ssl')),
            'username' => trim($request->request->get('username', '')),
            'password' => $request->request->get('password', ''),
        ];

        foreach (['label', 'email_address', 'imap_host', 'username'] as $field) {
            if ($input[$field] === '') {
                return new JsonResponse([
                    'result' => 'ERROR',
                    'message' => 'Required mail account fields are missing',
                ], 400);
            }
        }

        if ($input['id'] === '' && trim($input['password']) === '') {
            return new JsonResponse([
                'result' => 'ERROR',
                'message' => 'A password is required for new mail accounts',
            ], 400);
        }

        $account = $app['mail.accounts']->save($app['session']->get('username'), $input);
        if ($account === null) {
            return new JsonResponse([
                'result' => 'ERROR',
                'message' => 'Mail account not found',
            ], 404);
        }

        return new JsonResponse([
            'result' => 'SUCCESS',
            'data' => $account,
        ]);
    }

    public function messagesAction(Request $request, Application $app)
    {
        $account = $app['mail.accounts']->findWithPassword(
            $app['session']->get('username'),
            (int)$request->query->get('account_id')
        );

        if ($account === null) {
            return new JsonResponse([
                'result' => 'ERROR',
                'message' => 'Mail account not found',
            ], 404);
        }

        try {
            $messages = $app['mail.imap.client']->fetchInbox($account);
        } catch (\RuntimeException $exception) {
            return new JsonResponse([
                'result' => 'ERROR',
                'message' => $exception->getMessage(),
            ], 502);
        }

        return new JsonResponse([
            'result' => 'SUCCESS',
            'data' => $messages,
        ]);
    }
}
