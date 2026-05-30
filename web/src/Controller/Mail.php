<?php
namespace Caldaver\Controller;

use Caldaver\Mail\AccountValidator;
use Silex\Application;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

class Mail
{
    public function indexAction(Request $request, Application $app)
    {
        return $app['twig']->render('mail.html', [
            'mail_javascript_enabled' => $this->javascriptEnabled($request, $app),
        ]);
    }

    public function readAction(Request $request, Application $app)
    {
        return $app['twig']->render('mail_message.html', [
            'account_id' => (int)$request->query->get('account_id'),
            'uid' => (int)$request->query->get('uid'),
            'mail_javascript_enabled' => $this->javascriptEnabled($request, $app),
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
            'refresh_interval_minutes' => trim($request->request->get('refresh_interval_minutes', '1')),
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

        return new JsonResponse([
            'result' => 'SUCCESS',
            'data' => $app['mail.accounts']->cachedMessages($app['session']->get('username'), $account['id']),
            'cached' => true,
        ]);
    }

    public function syncMessagesAction(Request $request, Application $app)
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
            $app['mail.accounts']->replaceMessageCache($app['session']->get('username'), $account['id'], $messages);
        } catch (\RuntimeException $exception) {
            return new JsonResponse([
                'result' => 'ERROR',
                'message' => $exception->getMessage(),
            ], 502);
        }

        return new JsonResponse([
            'result' => 'SUCCESS',
            'data' => $messages,
            'cached' => false,
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
            if ($message !== null) {
                $app['mail.imap.client']->markSeen($account, $uid, true);
                $message['seen'] = true;
                $app['mail.accounts']->cacheMessage($app['session']->get('username'), $account['id'], $message);
            }
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

    public function markUnreadAction(Request $request, Application $app)
    {
        $account = $app['mail.accounts']->findWithPassword(
            $app['session']->get('username'),
            (int)$request->request->get('account_id')
        );

        if ($account === null) {
            return new JsonResponse([
                'result' => 'ERROR',
                'message' => 'Mail account not found',
            ], 404);
        }

        $uid = (int)$request->request->get('uid');
        if ($uid <= 0) {
            return new JsonResponse([
                'result' => 'ERROR',
                'message' => 'Message not found',
            ], 404);
        }

        try {
            $app['mail.imap.client']->markSeen($account, $uid, false);
            $app['mail.accounts']->markCachedSeen($app['session']->get('username'), $account['id'], $uid, false);
        } catch (\RuntimeException $exception) {
            return new JsonResponse([
                'result' => 'ERROR',
                'message' => $exception->getMessage(),
            ], 502);
        }

        return new JsonResponse([
            'result' => 'SUCCESS',
            'data' => [
                'uid' => $uid,
                'seen' => false,
            ],
        ]);
    }

    private function javascriptEnabled(Request $request, Application $app)
    {
        $nojs = strtolower((string)$request->query->get('nojs', ''));
        if (in_array($nojs, ['1', 'true', 'yes'], true)) {
            return false;
        }

        return !isset($app['user.preferences']) || !$app['user.preferences']->get('disable_javascript', false);
    }

}
