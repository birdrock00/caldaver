<?php
namespace AgenDAV\Controller;

use AgenDAV\CardDAV\AddressBook;
use AgenDAV\Data\Principal;
use Silex\Application;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

class Cards
{
    public function indexAction(Request $request, Application $app)
    {
        return $app['twig']->render('cards.html');
    }

    public function listAction(Request $request, Application $app)
    {
        $addressBooks = $this->getAddressBooks($app);
        $primaryAddressBook = reset($addressBooks);
        $contacts = array_map(function($contact) {
            return $contact->toArray();
        }, $app['carddav.client']->fetchContactsFromAddressBooks($addressBooks));

        return new JsonResponse([
            'data' => $contacts,
            'addressbooks' => array_map(function(AddressBook $addressBook) {
                return [
                    'url' => $addressBook->getUrl(),
                    'displayname' => $addressBook->getProperty(AddressBook::DISPLAYNAME),
                ];
            }, array_values($addressBooks)),
            'addressbook' => [
                'url' => $primaryAddressBook->getUrl(),
                'displayname' => $primaryAddressBook->getProperty(AddressBook::DISPLAYNAME),
            ],
        ]);
    }

    public function saveAction(Request $request, Application $app)
    {
        $fullName = trim($request->request->get('full_name', ''));
        if ($fullName === '') {
            return new JsonResponse([
                'result' => 'ERROR',
                'message' => 'Full name is required',
            ], 400);
        }

        $addressBook = $this->getAddressBook($app);
        $contact = $app['carddav.client']->createContact($addressBook, [
            'full_name' => $fullName,
            'email' => $request->request->get('email', ''),
            'phone' => $request->request->get('phone', ''),
            'organization' => $request->request->get('organization', ''),
            'job_title' => $request->request->get('job_title', ''),
        ]);

        return new JsonResponse([
            'result' => 'SUCCESS',
            'data' => $contact->toArray(),
        ]);
    }

    public function deleteAction(Request $request, Application $app)
    {
        $url = trim($request->request->get('url', ''));
        if ($url === '') {
            return new JsonResponse([
                'result' => 'ERROR',
                'message' => 'Contact URL is required',
            ], 400);
        }

        $app['carddav.client']->deleteContact($url, $request->request->get('etag', ''));

        return new JsonResponse([
            'result' => 'SUCCESS',
            'message' => '',
        ]);
    }

    protected function getAddressBook(Application $app)
    {
        $homeSet = $this->getAddressBookHomeSet($app);

        $displayName = trim($app['session']->get('displayname') ?: $app['session']->get('username'));
        if ($displayName === '') {
            $displayName = 'Contacts';
        }

        return $app['carddav.client']->getOrCreateDefaultAddressBook(
            $homeSet,
            $displayName . ' addressbook'
        );
    }

    protected function getAddressBooks(Application $app)
    {
        $homeSet = $this->getAddressBookHomeSet($app);
        $addressBooks = $app['carddav.client']->getAddressBooks($homeSet);

        if (count($addressBooks) > 0) {
            return $addressBooks;
        }

        return [$this->getAddressBook($app)];
    }

    protected function getAddressBookHomeSet(Application $app)
    {
        $homeSet = $app['session']->get('addressbook_home_set');
        if (!empty($homeSet)) {
            return $homeSet;
        }

        $principal = new Principal($app['session']->get('principal_url'));
        $homeSet = $app['carddav.client']->getAddressBookHomeSet($principal);
        $app['session']->set('addressbook_home_set', $homeSet);

        return $homeSet;
    }
}
