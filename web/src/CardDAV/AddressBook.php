<?php
namespace AgenDAV\CardDAV;

class AddressBook
{
    const DISPLAYNAME = '{DAV:}displayname';
    const DESCRIPTION = '{urn:ietf:params:xml:ns:carddav}addressbook-description';
    const CTAG = '{http://calendarserver.org/ns/}getctag';

    protected $url;
    protected $properties;

    public function __construct($url, array $properties = [])
    {
        $this->url = $url;
        $this->properties = $properties;
    }

    public function getUrl()
    {
        return $this->url;
    }

    public function getProperty($property)
    {
        return $this->properties[$property] ?? null;
    }
}
