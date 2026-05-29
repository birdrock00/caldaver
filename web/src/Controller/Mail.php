<?php
namespace AgenDAV\Controller;

use AgenDAV\Mail\AccountValidator;
use Silex\Application;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

class Mail
{
    public function indexAction(Request $request, Application $app)
    {
        return $app['twig']->render('mail.html');
    }

    public function readAction(Request $request, Application $app)
    {
        return $app['twig']->render('mail_message.html', [
            'account_id' => (int)$request->query->get('account_id'),
            'uid' => (int)$request->query->get('uid'),
        ]);
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

        $validationError = AccountValidator::validate($input);
        if ($validationError !== null) {
            return new JsonResponse([
                'result' => 'ERROR',
                'message' => $validationError,
            ], 400);
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

    public function attachmentAction(Request $request, Application $app)
    {
        $account = $app['mail.accounts']->findWithPassword(
            $app['session']->get('username'),
            (int)$request->query->get('account_id')
        );

        if ($account === null) {
            return new Response('Mail account not found', 404);
        }

        $uid = (int)$request->query->get('uid');
        $part = trim($request->query->get('part', ''));
        if ($uid <= 0 || $part === '') {
            return new Response('Attachment not found', 404);
        }

        try {
            $attachment = $app['mail.imap.client']->downloadAttachment($account, $uid, $part);
        } catch (\RuntimeException $exception) {
            return new Response($exception->getMessage(), 502);
        }

        if ($attachment === null) {
            return new Response('Attachment not found', 404);
        }

        $filename = str_replace(['"', "\r", "\n"], '', $attachment['filename']);

        return new Response($attachment['body'], 200, [
            'Content-Type' => $attachment['content_type'],
            'Content-Length' => strlen($attachment['body']),
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function messageAction(Request $request, Application $app)
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

        $uid = (int)$request->query->get('uid');
        if ($uid <= 0) {
            return new JsonResponse([
                'result' => 'ERROR',
                'message' => 'Message not found',
            ], 404);
        }

        try {
            $message = $app['mail.imap.client']->fetchMessage($account, $uid);
        } catch (\RuntimeException $exception) {
            return new JsonResponse([
                'result' => 'ERROR',
                'message' => $exception->getMessage(),
            ], 502);
        }

        if ($message === null) {
            return new JsonResponse([
                'result' => 'ERROR',
                'message' => 'Message not found',
            ], 404);
        }

        return new JsonResponse([
            'result' => 'SUCCESS',
            'data' => $message,
        ]);
    }

}
