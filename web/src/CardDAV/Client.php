<?php
namespace AgenDAV\CardDAV;

use AgenDAV\Data\Principal;
use AgenDAV\Uuid;

class Client
{
    protected $httpClient;
    protected $xmlToolkit;

    public function __construct(\AgenDAV\Http\Client $httpClient, \AgenDAV\XML\Toolkit $xmlToolkit)
    {
        $this->httpClient = $httpClient;
        $this->xmlToolkit = $xmlToolkit;
    }

    public function getAddressBookHomeSet(Principal $principal)
    {
        $body = $this->xmlToolkit->generateRequestBody(
            'PROPFIND',
            ['{urn:ietf:params:xml:ns:carddav}addressbook-home-set']
        );

        $response = $this->propfind($principal->getUrl(), 0, $body);
        if (count($response) === 0 || !isset($response['{urn:ietf:params:xml:ns:carddav}addressbook-home-set'])) {
            return $principal->getUrl();
        }

        return $response['{urn:ietf:params:xml:ns:carddav}addressbook-home-set']->getHref();
    }

    public function getAddressBooks($url)
    {
        $body = $this->xmlToolkit->generateRequestBody(
            'PROPFIND',
            [
                '{DAV:}resourcetype',
                AddressBook::DISPLAYNAME,
                AddressBook::DESCRIPTION,
                AddressBook::CTAG,
            ]
        );

        $response = $this->propfind($url, 1, $body);
        $addressBooks = [];

        foreach ($response as $href => $properties) {
            if (!isset($properties['{DAV:}resourcetype'])) {
                continue;
            }

            if ($properties['{DAV:}resourcetype']->is('{urn:ietf:params:xml:ns:carddav}addressbook')) {
                $addressBooks[$href] = new AddressBook($href, $properties);
            }
        }

        return $addressBooks;
    }

    public function getOrCreateDefaultAddressBook($homeSet, $displayName)
    {
        $addressBooks = $this->getAddressBooks($homeSet);
        if (count($addressBooks) > 0) {
            reset($addressBooks);
            return current($addressBooks);
        }

        $url = rtrim($homeSet, '/') . '/' . Uuid::generate() . '/';
        $addressBook = new AddressBook($url, [
            AddressBook::DISPLAYNAME => $displayName,
            AddressBook::DESCRIPTION => $displayName,
        ]);
        $this->createAddressBook($addressBook);

        return $addressBook;
    }

    public function createAddressBook(AddressBook $addressBook)
    {
        $body = $this->xmlToolkit->generateRequestBody(
            'MKADDRESSBOOK',
            [
                AddressBook::DISPLAYNAME => $addressBook->getProperty(AddressBook::DISPLAYNAME),
                AddressBook::DESCRIPTION => $addressBook->getProperty(AddressBook::DESCRIPTION),
            ]
        );

        $this->httpClient->setContentTypeXML();
        $this->httpClient->request('MKCOL', $addressBook->getUrl(), $body);
    }

    public function fetchContacts(AddressBook $addressBook)
    {
        $body = $this->xmlToolkit->generateRequestBody('REPORT-ADDRESSBOOK', null);
        $data = $this->report($addressBook->getUrl(), $body);
        $contacts = [];

        foreach ($data as $url => $properties) {
            if (!isset($properties[Contact::DATA])) {
                continue;
            }

            $contacts[] = Contact::fromVCard(
                $url,
                $properties[Contact::ETAG] ?? null,
                $properties[Contact::DATA]
            );
        }

        usort($contacts, function(Contact $a, Contact $b) {
            return strcasecmp($a->toArray()['full_name'], $b->toArray()['full_name']);
        });

        return $contacts;
    }

    public function createContact(AddressBook $addressBook, array $data)
    {
        list($uid, $body) = Contact::buildVCard($data);
        $url = $addressBook->getUrl() . $uid . '.vcf';

        $this->httpClient->setContentTypeVCard();
        $this->httpClient->setHeader('If-None-Match', '*');
        $response = $this->httpClient->request('PUT', $url, $body);

        return Contact::fromVCard($url, $response->getHeaderLine('ETag'), $body);
    }

    public function deleteContact($url, $etag = null)
    {
        if ($etag !== null && $etag !== '') {
            $this->httpClient->setHeader('If-Match', $etag);
        }

        return $this->httpClient->request('DELETE', $url);
    }

    protected function propfind($url, $depth, $body)
    {
        $this->httpClient->setHeader('Depth', $depth);
        $this->httpClient->setContentTypeXML();
        $response = $this->httpClient->request('PROPFIND', $url, $body);

        return $this->xmlToolkit->parseMultistatus((string)$response->getBody(), $depth === 0);
    }

    protected function report($url, $body)
    {
        $this->httpClient->setHeader('Depth', 1);
        $this->httpClient->setContentTypeXML();
        $response = $this->httpClient->request('REPORT', $url, $body);

        return $this->xmlToolkit->parseMultistatus((string)$response->getBody());
    }
}
