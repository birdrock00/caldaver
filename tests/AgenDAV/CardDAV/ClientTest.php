<?php

namespace AgenDAV\CardDAV;

use AgenDAV\Http\Client as HttpClient;
use AgenDAV\XML\Generator;
use AgenDAV\XML\Parser;
use AgenDAV\XML\Toolkit;
use GuzzleHttp\Client as GuzzleClient;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;
use GuzzleHttp\Psr7\Utils;
use PHPUnit\Framework\TestCase;

class ClientTest extends TestCase
{
    protected $history = [];

    public function testFetchContactsFromAddressBooksDoesNotStopAtFirstEmptyAddressBook()
    {
        $client = $this->createCardDAVClient([
            new Response(207, [], Utils::streamFor($this->emptyAddressBookResponse())),
            new Response(207, [], Utils::streamFor($this->contactsResponse())),
        ]);

        $contacts = $client->fetchContactsFromAddressBooks([
            new AddressBook('/user/empty/'),
            new AddressBook('/user/imported/'),
        ]);

        $this->assertCount(2, $contacts);
        $this->assertSame('Alpha One', $contacts[0]->toArray()['full_name']);
        $this->assertSame('Beta Two', $contacts[1]->toArray()['full_name']);

        $this->assertCount(2, $this->history);
        $this->assertSame('/user/empty/', $this->history[0]['request']->getUri()->getPath());
        $this->assertSame('/user/imported/', $this->history[1]['request']->getUri()->getPath());
    }

    protected function createCardDAVClient(array $responses)
    {
        $mock = new MockHandler($responses);
        $handlerStack = HandlerStack::create($mock);
        $handlerStack->push(Middleware::history($this->history));

        $guzzle = new GuzzleClient([
            'base_uri' => 'https://radicale.example/',
            'handler' => $handlerStack,
        ]);

        return new Client(
            new HttpClient($guzzle),
            new Toolkit(new Parser(), new Generator())
        );
    }

    protected function emptyAddressBookResponse()
    {
        return <<<XML
<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav" />
XML;
    }

    protected function contactsResponse()
    {
        return <<<XML
<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:response>
    <d:href>/user/imported/alpha.vcf</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"alpha"</d:getetag>
        <card:address-data><![CDATA[BEGIN:VCARD
VERSION:4.0
UID:alpha
FN:Alpha One
N:One;Alpha;;;
EMAIL:alpha@example.test
TEL:+14155550101
END:VCARD
]]></card:address-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/user/imported/beta.vcf</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"beta"</d:getetag>
        <card:address-data><![CDATA[BEGIN:VCARD
VERSION:4.0
UID:beta
FN:Beta Two
N:Two;Beta;;;
EMAIL:beta@example.test
TEL:+14155550102
END:VCARD
]]></card:address-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>
XML;
    }
}
