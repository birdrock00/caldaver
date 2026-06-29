<?php

namespace AgenDAV\Session;

use RuntimeException;

/**
 * Authenticated symmetric encryption for short secrets (the CalDAV password)
 * stored in the session blob. Uses AES-256-GCM via ext-openssl.
 *
 * The session backend (PdoSessionHandler) keeps an authenticated user's
 * password serialised in the database. Encrypting it at rest with a key that
 * lives outside the database means a read-only DB compromise does not
 * directly leak CalDAV credentials.
 */
class PasswordCipher
{
    private const KEY_BYTES = 32;
    private const IV_BYTES = 12;
    private const TAG_BYTES = 16;
    private const CIPHER = 'aes-256-gcm';

    public function __construct(private string $key)
    {
        if (strlen($key) !== self::KEY_BYTES) {
            throw new RuntimeException(sprintf(
                'PasswordCipher key must be %d bytes, got %d',
                self::KEY_BYTES,
                strlen($key)
            ));
        }
    }

    public function encrypt(string $plaintext): string
    {
        $iv = random_bytes(self::IV_BYTES);
        $tag = '';
        $cipher = openssl_encrypt($plaintext, self::CIPHER, $this->key, OPENSSL_RAW_DATA, $iv, $tag, '', self::TAG_BYTES);
        if ($cipher === false) {
            throw new RuntimeException('Encryption failed');
        }
        return base64_encode($iv . $tag . $cipher);
    }

    /**
    * Returns null if the payload is malformed or fails authentication.
    */
    public function decrypt(string $payload): ?string
    {
        $raw = base64_decode($payload, true);
        $minLen = self::IV_BYTES + self::TAG_BYTES;
        if ($raw === false || strlen($raw) <= $minLen) {
            return null;
        }
        $iv = substr($raw, 0, self::IV_BYTES);
        $tag = substr($raw, self::IV_BYTES, self::TAG_BYTES);
        $cipher = substr($raw, $minLen);
        $plain = openssl_decrypt($cipher, self::CIPHER, $this->key, OPENSSL_RAW_DATA, $iv, $tag);
        return $plain === false ? null : $plain;
    }
}
