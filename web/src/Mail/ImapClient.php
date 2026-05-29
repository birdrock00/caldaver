<?php
namespace AgenDAV\Mail;

class ImapClient
{
    public function fetchInbox(array $account, $limit = 100)
    {
        if (!function_exists('imap_open')) {
            throw new \RuntimeException('The PHP IMAP extension is not installed.');
        }

        $mailbox = $this->mailboxString($account);
        $stream = @imap_open($mailbox, $account['username'], $account['password'], OP_READONLY, 1, [
            'DISABLE_AUTHENTICATOR' => 'GSSAPI',
        ]);

        if ($stream === false) {
            throw new \RuntimeException('Unable to connect to the IMAP account.');
        }

        try {
            $uids = imap_search($stream, 'ALL', SE_UID);
            if (!is_array($uids)) {
                return [];
            }

            rsort($uids, SORT_NUMERIC);
            $uids = array_slice($uids, 0, $limit);
            if (count($uids) === 0) {
                return [];
            }

            $overview = imap_fetch_overview($stream, implode(',', $uids), FT_UID);
            if (!is_array($overview)) {
                return [];
            }

            usort($overview, function($a, $b) {
                return strtotime($b->date ?? '') <=> strtotime($a->date ?? '');
            });

            return array_map(function($message) {
                return [
                    'uid' => (int)($message->uid ?? 0),
                    'from' => $this->decodeHeader($message->from ?? ''),
                    'subject' => $this->decodeHeader($message->subject ?? '(No subject)'),
                    'date' => $message->date ?? '',
                    'seen' => !empty($message->seen),
                ];
            }, $overview);
        } finally {
            imap_close($stream);
        }
    }

    protected function mailboxString(array $account)
    {
        $flags = '/imap';
        if ($account['encryption'] === 'ssl') {
            $flags .= '/ssl/novalidate-cert';
        } elseif ($account['encryption'] === 'tls') {
            $flags .= '/tls/novalidate-cert';
        } else {
            $flags .= '/notls';
        }

        return sprintf('{%s:%d%s}INBOX', $account['imap_host'], $account['imap_port'], $flags);
    }

    protected function decodeHeader($value)
    {
        $parts = imap_mime_header_decode((string)$value);
        if (!is_array($parts)) {
            return (string)$value;
        }

        $decoded = '';
        foreach ($parts as $part) {
            $decoded .= $part->text;
        }

        return $decoded;
    }
}
