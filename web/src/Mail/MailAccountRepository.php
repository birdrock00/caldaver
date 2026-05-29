<?php
namespace AgenDAV\Mail;

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
            'SELECT id, owner, label, email_address, imap_host, imap_port, encryption, username, created_at, updated_at
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
            'SELECT id, owner, label, email_address, imap_host, imap_port, encryption, username, password_encrypted, created_at, updated_at
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
                 SET label = ?, email_address = ?, imap_host = ?, imap_port = ?, encryption = ?, username = ?, password_encrypted = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE owner = ? AND id = ?',
                [
                    $input['label'],
                    $input['email_address'],
                    $input['imap_host'],
                    $port,
                    $encryption,
                    $input['username'],
                    $password,
                    $owner,
                    $id,
                ]
            );
        } else {
            $id = (int)$this->connection->fetchOne(
                'INSERT INTO mail_accounts (owner, label, email_address, imap_host, imap_port, encryption, username, password_encrypted, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
                ]
            );
        }

        $row = $this->connection->fetchAssociative(
            'SELECT id, owner, label, email_address, imap_host, imap_port, encryption, username, created_at, updated_at
             FROM mail_accounts
             WHERE owner = ? AND id = ?',
            [$owner, $id]
        );

        return $row ? $this->publicAccount($row) : null;
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
        ];
    }

    protected function encrypt($value)
    {
        $iv = random_bytes(16);
        $ciphertext = openssl_encrypt(
            (string)$value,
            'aes-256-cbc',
            $this->key(),
            OPENSSL_RAW_DATA,
            $iv
        );

        return base64_encode($iv . $ciphertext);
    }

    protected function decrypt($value)
    {
        $raw = base64_decode((string)$value, true);
        if ($raw === false || strlen($raw) <= 16) {
            return '';
        }

        $plain = openssl_decrypt(
            substr($raw, 16),
            'aes-256-cbc',
            $this->key(),
            OPENSSL_RAW_DATA,
            substr($raw, 0, 16)
        );

        return $plain === false ? '' : $plain;
    }

    protected function key()
    {
        return hash('sha256', $this->secret, true);
    }
}
