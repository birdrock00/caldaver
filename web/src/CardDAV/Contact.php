<?php
namespace AgenDAV\CardDAV;

use AgenDAV\Uuid;
use Sabre\VObject\Component\VCard;
use Sabre\VObject\Reader;

class Contact
{
    const DATA = '{urn:ietf:params:xml:ns:carddav}address-data';
    const ETAG = '{DAV:}getetag';

    protected $url;
    protected $etag;
    protected $uid;
    protected $fullName;
    protected $email;
    protected $phone;
    protected $organization;
    protected $jobTitle;
    protected $labels;

    public function __construct(
        $url,
        $etag,
        $uid,
        $fullName,
        $email = '',
        $phone = '',
        $organization = '',
        $jobTitle = '',
        array $labels = []
    ) {
        $this->url = $url;
        $this->etag = $etag;
        $this->uid = $uid;
        $this->fullName = $fullName;
        $this->email = $email;
        $this->phone = $phone;
        $this->organization = $organization;
        $this->jobTitle = $jobTitle;
        $this->labels = $labels;
    }

    public static function fromVCard($url, $etag, $rawVCard)
    {
        $vcard = Reader::read($rawVCard, Reader::OPTION_FORGIVING | Reader::OPTION_IGNORE_INVALID_LINES);
        $fullName = self::firstValue($vcard, 'FN') ?: self::firstValue($vcard, 'N') ?: 'Unnamed contact';

        return new self(
            $url,
            $etag,
            self::firstValue($vcard, 'UID') ?: basename($url, '.vcf'),
            $fullName,
            self::firstValue($vcard, 'EMAIL'),
            self::firstValue($vcard, 'TEL'),
            self::organization($vcard),
            self::firstValue($vcard, 'TITLE'),
            self::categories($vcard)
        );
    }

    public static function buildVCard(array $data)
    {
        $uid = $data['uid'] ?? Uuid::generate();
        $fullName = trim($data['full_name'] ?? '');
        $organization = trim($data['organization'] ?? '');
        $jobTitle = trim($data['job_title'] ?? '');

        $vcard = new VCard([
            'VERSION' => '4.0',
            'UID' => $uid,
            'FN' => $fullName,
        ]);

        $vcard->add('N', self::nameParts($fullName));

        if (!empty($data['email'])) {
            $vcard->add('EMAIL', trim($data['email']), ['TYPE' => 'internet']);
        }

        if (!empty($data['phone'])) {
            $vcard->add('TEL', trim($data['phone']), ['TYPE' => 'cell']);
        }

        if ($organization !== '') {
            $vcard->add('ORG', [$organization]);
        }

        if ($jobTitle !== '') {
            $vcard->add('TITLE', $jobTitle);
        }

        return [$uid, $vcard->serialize()];
    }

    public function toArray()
    {
        return [
            'url' => $this->url,
            'etag' => $this->etag,
            'uid' => $this->uid,
            'full_name' => $this->fullName,
            'email' => $this->email,
            'phone' => $this->phone,
            'organization' => $this->organization,
            'job_title' => $this->jobTitle,
            'company_line' => trim($this->jobTitle . ($this->jobTitle && $this->organization ? ' at ' : '') . $this->organization),
            'labels' => $this->labels,
            'initial' => strtoupper(substr($this->fullName, 0, 1)),
            'avatar_color' => $this->avatarColor(),
        ];
    }

    protected static function firstValue($vcard, $name)
    {
        if (!isset($vcard->{$name})) {
            return '';
        }

        return trim((string)$vcard->{$name});
    }

    protected static function organization($vcard)
    {
        if (!isset($vcard->ORG)) {
            return '';
        }

        $value = $vcard->ORG->getParts();
        if (is_array($value)) {
            return trim(implode(' ', array_filter($value)));
        }

        return trim((string)$vcard->ORG);
    }

    protected static function categories($vcard)
    {
        if (!isset($vcard->CATEGORIES)) {
            return [];
        }

        return array_values(array_filter(array_map('trim', explode(',', (string)$vcard->CATEGORIES))));
    }

    protected static function nameParts($fullName)
    {
        $parts = preg_split('/\s+/', trim($fullName));
        if (!$parts || count($parts) === 1) {
            return ['', $fullName, '', '', ''];
        }

        $lastName = array_pop($parts);
        return [$lastName, implode(' ', $parts), '', '', ''];
    }

    protected function avatarColor()
    {
        $colors = ['#1a73e8', '#188038', '#9334e6', '#d93025', '#00897b', '#5f6368', '#c5221f', '#7b1fa2'];
        return $colors[abs(crc32($this->fullName)) % count($colors)];
    }
}
