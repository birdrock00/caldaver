<?php
namespace AgenDAV\Mail;

class AccountValidator
{
    public static function validate(array $account)
    {
        $port = filter_var($account['imap_port'] ?? null, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1, 'max_range' => 65535],
        ]);
        if ($port === false) {
            return 'IMAP port must be between 1 and 65535';
        }

        $host = strtolower(trim($account['imap_host'] ?? ''));
        if ($host === 'localhost' || substr($host, -10) === '.localhost') {
            return 'IMAP host cannot be localhost';
        }

        if (filter_var($host, FILTER_VALIDATE_IP)) {
            return self::isPublicIp($host) ? null : 'IMAP host cannot be a private or reserved address';
        }

        if (!preg_match('/\A[a-z0-9.-]+\z/', $host) || strpos($host, '.') === false) {
            return 'IMAP host must be a valid hostname';
        }

        $addresses = self::resolve($host);
        if (count($addresses) === 0) {
            return 'IMAP host must resolve to a public address';
        }

        foreach ($addresses as $address) {
            if (!self::isPublicIp($address)) {
                return 'IMAP host cannot resolve to a private or reserved address';
            }
        }

        return null;
    }

    public static function assertValid(array $account)
    {
        $error = self::validate($account);
        if ($error !== null) {
            throw new \RuntimeException($error);
        }
    }

    protected static function resolve($host)
    {
        $records = dns_get_record($host, DNS_A + DNS_AAAA);
        if (!is_array($records)) {
            return [];
        }

        $addresses = [];
        foreach ($records as $record) {
            if (!empty($record['ip'])) {
                $addresses[] = $record['ip'];
            }
            if (!empty($record['ipv6'])) {
                $addresses[] = $record['ipv6'];
            }
        }

        return array_values(array_unique($addresses));
    }

    protected static function isPublicIp($address)
    {
        return filter_var(
            $address,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
        ) !== false;
    }
}
