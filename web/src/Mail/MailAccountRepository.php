<?php
namespace Caldaver\Mail;

use Doctrine\DBAL\Connection;

class MailAccountRepository
{
    protected $connection;
    protected $secret;

    public function __construct(Connection $connection, $secret)
    {
        $this->connection = $connection;
        $this->secret = (string)$secret;
    }

    public function findForOwner($owner)
    {
        $rows = $this->connection->fetchAllAssociative(
            'SELECT id, owner, label, email_address, imap_host, imap_port, encryption, username, refresh_interval_seconds, created_at, updated_at
             FROM mail_accounts
             WHERE owner = ?
             ORDER BY label ASC, email_address ASC',
            [$owner]
        );

        return array_map([$this, 'publicAccount'], $rows);
    }

    public function findWithPassword($owner, $id)
    {
        $row = $this->connection->fetchAssociative(
            'SELECT id, owner, label, email_address, imap_host, imap_port, encryption, username, password_encrypted, refresh_interval_seconds, created_at, updated_at
             FROM mail_accounts
             WHERE owner = ? AND id = ?',
            [$owner, $id]
        );

        if (!$row) {
            return null;
        }

        $row['password'] = $this->decrypt($row['password_encrypted']);
        unset($row['password_encrypted']);

        return $this->publicAccount($row) + ['password' => $row['password']];
    }

    public function save($owner, array $input)
    {
        $id = isset($input['id']) && $input['id'] !== '' ? (int)$input['id'] : null;
        $port = isset($input['imap_port']) && $input['imap_port'] !== '' ? (int)$input['imap_port'] : 993;
        $encryption = in_array($input['encryption'] ?? 'ssl', ['ssl', 'tls', 'none'], true)
            ? $input['encryption']
            : 'ssl';
        $refreshInterval = $this->refreshIntervalSeconds($input);

        if ($id === null) {
            $id = $this->matchingAccountId($owner, $input, $port, $encryption);
        }

        if ($id !== null) {
            $current = $this->connection->fetchAssociative(
                'SELECT password_encrypted FROM mail_accounts WHERE owner = ? AND id = ?',
                [$owner, $id]
            );

            if (!$current) {
                return null;
            }

            $password = trim($input['password'] ?? '') !== ''
                ? $this->encrypt($input['password'])
                : $current['password_encrypted'];

            $this->connection->executeStatement(
                'UPDATE mail_accounts
                 SET label = ?, email_address = ?, imap_host = ?, imap_port = ?, encryption = ?, username = ?, password_encrypted = ?, refresh_interval_seconds = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE owner = ? AND id = ?',
                [
                    $input['label'],
                    $input['email_address'],
                    $input['imap_host'],
                    $port,
                    $encryption,
                    $input['username'],
                    $password,
                    $refreshInterval,
                    $owner,
                    $id,
                ]
            );
        } else {
            $id = (int)$this->connection->fetchOne(
                'INSERT INTO mail_accounts (owner, label, email_address, imap_host, imap_port, encryption, username, password_encrypted, refresh_interval_seconds, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                 RETURNING id',
                [
                    $owner,
                    $input['label'],
                    $input['email_address'],
                    $input['imap_host'],
                    $port,
                    $encryption,
                    $input['username'],
                    $this->encrypt($input['password']),
                    $refreshInterval,
                ]
            );
        }

        $row = $this->connection->fetchAssociative(
            'SELECT id, owner, label, email_address, imap_host, imap_port, encryption, username, refresh_interval_seconds, created_at, updated_at
             FROM mail_accounts
             WHERE owner = ? AND id = ?',
            [$owner, $id]
        );

        return $row ? $this->publicAccount($row) : null;
    }

    public function cachedMessages($owner, $accountId)
    {
        $rows = $this->connection->fetchAllAssociative(
            'SELECT cache.uid, cache.from_header, cache.subject, cache.date_header, cache.seen, cache.attachments, cache.body, cache.html_body
             FROM mail_message_cache cache
             INNER JOIN mail_accounts account ON account.id = cache.account_id
             WHERE account.owner = ? AND cache.account_id = ?
             ORDER BY cache.position ASC, cache.uid DESC',
            [$owner, $accountId]
        );

        return array_map([$this, 'cachedMessageRow'], $rows);
    }

    public function cachedMessage($owner, $accountId, $uid)
    {
        $row = $this->connection->fetchAssociative(
            'SELECT cache.uid, cache.from_header, cache.subject, cache.date_header, cache.seen, cache.attachments, cache.body, cache.html_body
             FROM mail_message_cache cache
             INNER JOIN mail_accounts account ON account.id = cache.account_id
             WHERE account.owner = ? AND cache.account_id = ? AND cache.uid = ?',
            [$owner, $accountId, $uid]
        );

        return $row ? $this->cachedMessageRow($row, true) : null;
    }

    public function markCachedSeen($owner, $accountId, $uid, $seen)
    {
        $this->connection->executeStatement(
            'UPDATE mail_message_cache
             SET seen = ?, updated_at = CURRENT_TIMESTAMP
             WHERE owner = ? AND account_id = ? AND uid = ?',
            [!empty($seen) ? 1 : 0, $owner, $accountId, $uid]
        );
    }

    public function replaceMessageCache($owner, $accountId, array $messages)
    {
        $this->connection->executeStatement(
            'DELETE FROM mail_message_cache WHERE owner = ? AND account_id = ?',
            [$owner, $accountId]
        );

        foreach (array_values($messages) as $position => $message) {
            $this->insertCachedMessage($owner, $accountId, $message, $position);
        }
    }

    public function cacheMessage($owner, $accountId, array $message)
    {
        $this->connection->executeStatement(
            'INSERT INTO mail_message_cache (owner, account_id, uid, position, from_header, subject, date_header, seen, attachments, body, html_body, updated_at)
             VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT (account_id, uid)
             DO UPDATE SET from_header = EXCLUDED.from_header,
                           subject = EXCLUDED.subject,
                           date_header = EXCLUDED.date_header,
                           seen = EXCLUDED.seen,
                           attachments = EXCLUDED.attachments,
                           body = EXCLUDED.body,
                           html_body = EXCLUDED.html_body,
                           updated_at = CURRENT_TIMESTAMP',
            [
                $owner,
                $accountId,
                (int)$message['uid'],
                $message['from'] ?? '',
                $message['subject'] ?? '',
                $message['date'] ?? '',
                !empty($message['seen']) ? 1 : 0,
                json_encode($message['attachments'] ?? []),
                $message['body'] ?? null,
                $message['html_body'] ?? null,
            ]
        );
    }

    protected function matchingAccountId($owner, array $input, $port, $encryption)
    {
        $id = $this->connection->fetchOne(
            'SELECT id
             FROM mail_accounts
             WHERE owner = ?
               AND lower(email_address) = lower(?)
               AND lower(imap_host) = lower(?)
               AND imap_port = ?
               AND encryption = ?
             ORDER BY id DESC
             LIMIT 1',
            [
                $owner,
                $input['email_address'],
                $input['imap_host'],
                $port,
                $encryption,
            ]
        );

        return $id === false ? null : (int)$id;
    }

    protected function publicAccount(array $row)
    {
        return [
            'id' => (int)$row['id'],
            'label' => $row['label'],
            'email_address' => $row['email_address'],
            'imap_host' => $row['imap_host'],
            'imap_port' => (int)$row['imap_port'],
            'encryption' => $row['encryption'],
            'username' => $row['username'],
            'refresh_interval_seconds' => isset($row['refresh_interval_seconds']) ? (int)$row['refresh_interval_seconds'] : 60,
        ];
    }

    protected function refreshIntervalSeconds(array $input)
    {
        if (isset($input['refresh_interval_seconds'])) {
            $seconds = (int)$input['refresh_interval_seconds'];
        } else {
            $minutes = isset($input['refresh_interval_minutes']) ? (int)$input['refresh_interval_minutes'] : 1;
            $seconds = $minutes * 60;
        }

        return max(60, min(86400, $seconds));
    }

    protected function insertCachedMessage($owner, $accountId, array $message, $position)
    {
        $this->connection->executeStatement(
            'INSERT INTO mail_message_cache (owner, account_id, uid, position, from_header, subject, date_header, seen, attachments, body, html_body, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
            [
                $owner,
                $accountId,
                (int)$message['uid'],
                (int)$position,
                $message['from'] ?? '',
                $message['subject'] ?? '',
                $message['date'] ?? '',
                !empty($message['seen']) ? 1 : 0,
                json_encode($message['attachments'] ?? []),
                $message['body'] ?? null,
                $message['html_body'] ?? null,
            ]
        );
    }

    protected function cachedMessageRow(array $row, $includeBody = false)
    {
        $message = [
            'uid' => (int)$row['uid'],
            'from' => $row['from_header'],
            'subject' => $row['subject'],
            'date' => $row['date_header'],
            'seen' => $this->booleanValue($row['seen']),
            'attachments' => json_decode($row['attachments'] ?: '[]', true) ?: [],
        ];

        if ($includeBody || $row['body'] !== null) {
            $message['body'] = $row['body'] ?? '';
        }

        if ($includeBody || $row['html_body'] !== null) {
            $message['html_body'] = $row['html_body'] ?? '';
        }

        return $message;
    }

    protected function booleanValue($value)
    {
        if (is_bool($value)) {
            return $value;
        }

        return in_array(strtolower((string)$value), ['1', 't', 'true', 'yes'], true);
    }

    protected function encrypt($value)
    {
        $iv = random_bytes(12);
        $tag = '';
        $ciphertext = openssl_encrypt(
            (string)$value,
            'aes-256-gcm',
            $this->key(),
            OPENSSL_RAW_DATA,
            $iv,
            $tag
        );

        return 'gcm:' . base64_encode($iv . $tag . $ciphertext);
    }

    protected function decrypt($value)
    {
        if (strpos((string)$value, 'gcm:') === 0) {
            return $this->decryptGcm(substr((string)$value, 4));
        }

        $raw = base64_decode((string)$value, true);
        if ($raw === false || strlen($raw) <= 16) {
            return '';
        }

        $plain = openssl_decrypt(
            substr($raw, 16),
            'aes-256-cbc',
            $this->legacyKey(),
            OPENSSL_RAW_DATA,
            substr($raw, 0, 16)
        );

        return $plain === false ? '' : $plain;
    }

    protected function decryptGcm($value)
    {
        $raw = base64_decode((string)$value, true);
        if ($raw === false || strlen($raw) <= 28) {
            return '';
        }

        $plain = openssl_decrypt(
            substr($raw, 28),
            'aes-256-gcm',
            $this->key(),
            OPENSSL_RAW_DATA,
            substr($raw, 0, 12),
            substr($raw, 12, 16)
        );

        return $plain === false ? '' : $plain;
    }

    protected function key()
    {
        return hash('sha256', 'mail-account-credentials:' . $this->secret, true);
    }

    protected function legacyKey()
    {
        return hash('sha256', $this->secret, true);
    }
}
