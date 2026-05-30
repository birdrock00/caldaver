<?php
namespace AgenDAV\Mail;

class ImapClient
{
    const TIMEOUT_SECONDS = 10;

    public function fetchInbox(array $account, $limit = 100)
    {
        AccountValidator::assertValid($account);

        if (!function_exists('imap_open')) {
            throw new \RuntimeException('The PHP IMAP extension is not installed.');
        }

        $stream = $this->openMailbox($account);

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

            return array_map(function($message) use ($stream) {
                $uid = (int)($message->uid ?? 0);
                return [
                    'uid' => $uid,
                    'from' => $this->decodeHeader($message->from ?? ''),
                    'subject' => $this->decodeHeader($message->subject ?? '(No subject)'),
                    'date' => $message->date ?? '',
                    'seen' => !empty($message->seen),
                    'attachments' => $this->attachmentsForMessage($stream, $uid),
                ];
            }, $overview);
        } finally {
            imap_close($stream);
        }
    }

    public function downloadAttachment(array $account, $uid, $part)
    {
        AccountValidator::assertValid($account);

        if (!function_exists('imap_open')) {
            throw new \RuntimeException('The PHP IMAP extension is not installed.');
        }

        $stream = $this->openMailbox($account);

        if ($stream === false) {
            throw new \RuntimeException('Unable to connect to the IMAP account.');
        }

        try {
            $structure = imap_fetchstructure($stream, $uid, FT_UID);
            if ($structure === false) {
                return null;
            }

            $attachment = $this->findAttachment($structure, (string)$part);
            if ($attachment === null) {
                return null;
            }

            $body = imap_fetchbody($stream, $uid, (string)$part, FT_UID);
            if ($body === false) {
                return null;
            }

            return [
                'filename' => $attachment['filename'],
                'content_type' => $attachment['content_type'],
                'body' => $this->decodeBody($body, $attachment['encoding']),
            ];
        } finally {
            imap_close($stream);
        }
    }

    public function fetchMessage(array $account, $uid)
    {
        AccountValidator::assertValid($account);

        if (!function_exists('imap_open')) {
            throw new \RuntimeException('The PHP IMAP extension is not installed.');
        }

        $stream = $this->openMailbox($account);

        if ($stream === false) {
            throw new \RuntimeException('Unable to connect to the IMAP account.');
        }

        try {
            $overview = imap_fetch_overview($stream, (string)$uid, FT_UID);
            $structure = imap_fetchstructure($stream, $uid, FT_UID);
            if (!is_array($overview) || count($overview) === 0 || $structure === false) {
                return null;
            }

            $message = $overview[0];

            return [
                'uid' => (int)$uid,
                'from' => $this->decodeHeader($message->from ?? ''),
                'subject' => $this->decodeHeader($message->subject ?? '(No subject)'),
                'date' => $message->date ?? '',
                'seen' => !empty($message->seen),
                'body' => $this->messageBody($stream, $uid, $structure),
                'attachments' => $this->collectAttachments($structure),
            ];
        } finally {
            imap_close($stream);
        }
    }

    public function markSeen(array $account, $uid, $seen)
    {
        AccountValidator::assertValid($account);

        if (!function_exists('imap_open')) {
            throw new \RuntimeException('The PHP IMAP extension is not installed.');
        }

        $stream = $this->openMailbox($account, false);

        if ($stream === false) {
            throw new \RuntimeException('Unable to connect to the IMAP account.');
        }

        try {
            $result = $seen
                ? imap_setflag_full($stream, (string)$uid, '\\Seen', ST_UID)
                : imap_clearflag_full($stream, (string)$uid, '\\Seen', ST_UID);

            if (!$result) {
                throw new \RuntimeException('Unable to update the message read status.');
            }
        } finally {
            imap_close($stream);
        }
    }

    protected function mailboxString(array $account)
    {
        $flags = '/imap';
        if ($account['encryption'] === 'ssl') {
            $flags .= '/ssl';
        } elseif ($account['encryption'] === 'tls') {
            $flags .= '/tls';
        } else {
            $flags .= '/notls';
        }

        return sprintf('{%s:%d%s}INBOX', $account['imap_host'], $account['imap_port'], $flags);
    }

    protected function openMailbox(array $account, $readOnly = true)
    {
        $this->configureTimeouts();

        foreach ($this->candidateUsernames($account) as $username) {
            $stream = @imap_open($this->mailboxString($account), $username, $account['password'], $readOnly ? OP_READONLY : 0, 1, [
                'DISABLE_AUTHENTICATOR' => 'GSSAPI',
            ]);

            if ($stream !== false) {
                return $stream;
            }
        }

        return false;
    }

    protected function candidateUsernames(array $account)
    {
        $usernames = [(string)$account['username']];
        $email = (string)($account['email_address'] ?? '');

        if (strpos($usernames[0], '@') === false && $email !== '' && !in_array($email, $usernames, true)) {
            $usernames[] = $email;
        }

        return $usernames;
    }

    protected function configureTimeouts()
    {
        if (!function_exists('imap_timeout')) {
            return;
        }

        foreach (['IMAP_OPENTIMEOUT', 'IMAP_READTIMEOUT', 'IMAP_WRITETIMEOUT', 'IMAP_CLOSETIMEOUT'] as $constant) {
            if (defined($constant)) {
                @imap_timeout(constant($constant), self::TIMEOUT_SECONDS);
            }
        }
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

    protected function attachmentsForMessage($stream, $uid)
    {
        if ($uid <= 0) {
            return [];
        }

        $structure = imap_fetchstructure($stream, $uid, FT_UID);
        if ($structure === false) {
            return [];
        }

        return $this->collectAttachments($structure);
    }

    protected function collectAttachments($structure, $prefix = '')
    {
        $attachments = [];

        if (!empty($structure->parts) && is_array($structure->parts)) {
            foreach ($structure->parts as $index => $part) {
                $partNumber = $prefix === '' ? (string)($index + 1) : $prefix . '.' . ($index + 1);
                $attachments = array_merge($attachments, $this->collectAttachments($part, $partNumber));
            }

            return $attachments;
        }

        $metadata = $this->attachmentMetadata($structure, $prefix === '' ? '1' : $prefix);
        return $metadata === null ? [] : [$metadata];
    }

    protected function findAttachment($structure, $part)
    {
        foreach ($this->collectAttachments($structure) as $attachment) {
            if ($attachment['part'] === $part) {
                return $attachment;
            }
        }

        return null;
    }

    protected function attachmentMetadata($part, $partNumber)
    {
        $filename = $this->partFilename($part);
        $disposition = strtoupper($part->disposition ?? '');

        if ($filename === '' && !in_array($disposition, ['ATTACHMENT', 'INLINE'], true)) {
            return null;
        }

        return [
            'part' => $partNumber,
            'filename' => $filename !== '' ? $this->decodeHeader($filename) : 'attachment-' . $partNumber,
            'content_type' => $this->contentType($part),
            'size' => (int)($part->bytes ?? 0),
            'encoding' => (int)($part->encoding ?? 0),
        ];
    }

    protected function partFilename($part)
    {
        foreach (['dparameters', 'parameters'] as $property) {
            if (empty($part->{$property}) || !is_array($part->{$property})) {
                continue;
            }

            foreach ($part->{$property} as $parameter) {
                $attribute = strtolower($parameter->attribute ?? '');
                if (in_array($attribute, ['filename', 'name'], true)) {
                    return (string)$parameter->value;
                }
            }
        }

        return '';
    }

    protected function contentType($part)
    {
        $types = ['text', 'multipart', 'message', 'application', 'audio', 'image', 'video', 'model', 'application'];
        $primary = $types[(int)($part->type ?? 8)] ?? 'application';
        $subtype = strtolower($part->subtype ?? 'octet-stream');

        return $primary . '/' . $subtype;
    }

    protected function decodeBody($body, $encoding)
    {
        if ((int)$encoding === ENCBASE64) {
            return base64_decode($body) ?: '';
        }

        if ((int)$encoding === ENCQUOTEDPRINTABLE) {
            return quoted_printable_decode($body);
        }

        return $body;
    }

    protected function messageBody($stream, $uid, $structure)
    {
        $plain = $this->findTextPart($stream, $uid, $structure, 'plain');
        if ($plain !== '') {
            return $plain;
        }

        $html = $this->findTextPart($stream, $uid, $structure, 'html');
        return $html === '' ? '' : trim(html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    }

    protected function findTextPart($stream, $uid, $part, $subtype, $prefix = '')
    {
        if (!empty($part->parts) && is_array($part->parts)) {
            foreach ($part->parts as $index => $child) {
                $partNumber = $prefix === '' ? (string)($index + 1) : $prefix . '.' . ($index + 1);
                $body = $this->findTextPart($stream, $uid, $child, $subtype, $partNumber);
                if ($body !== '') {
                    return $body;
                }
            }

            return '';
        }

        if ((int)($part->type ?? -1) !== 0 || strtolower($part->subtype ?? '') !== $subtype) {
            return '';
        }

        $partNumber = $prefix === '' ? '1' : $prefix;
        $body = $prefix === ''
            ? imap_body($stream, $uid, FT_UID)
            : imap_fetchbody($stream, $uid, $partNumber, FT_UID);

        if ($body === false) {
            return '';
        }

        return trim($this->decodeBody($body, (int)($part->encoding ?? 0)));
    }
}
