.. _delegations:

Calendar delegations
====================

AgenDAV supports CalDAV calendar delegations (also called proxy calendars).
When another user grants you access to their calendar, it appears automatically
in your AgenDAV sidebar alongside your own calendars.

How it works
------------

Delegation uses the CalDAV proxy principal mechanism
(`draft-desruisseaux-caldav-sched <https://www.rfc-editor.org/rfc/rfc6638>`_
and the CalendarServer extension). The CalDAV server exposes two properties on
each principal:

- ``calendar-proxy-read-for`` - principals whose calendars you can read
- ``calendar-proxy-write-for`` - principals whose calendars you can read and write

AgenDAV reads these properties at login and fetches the calendars of each
delegating user. Delegated calendars are visually grouped under the owner's
name in the sidebar. Read-only delegated calendars do not show create, edit,
or delete actions.

No AgenDAV configuration is required to enable delegations. The feature is
active as long as the CalDAV server exposes the proxy principal properties.

Nextcloud example
-----------------

Nextcloud supports CalDAV delegation through its Calendar app.

**Granting access (calendar owner)**

1. Open the Nextcloud Calendar app.
2. Click the three-dot menu next to the calendar you want to share.
3. Choose **Share link** or **Share with users/groups**.
4. Enter the username of the person you want to grant access to.
5. Choose **can edit** (read-write) or leave it at the default (read-only).
6. Confirm.

The other user will see the calendar in AgenDAV on their next page load or
after refreshing.

**What the delegate sees**

- The shared calendar appears in the sidebar under a section labelled with the
  owner's principal URL or display name.
- A read-only calendar shows no create/edit/delete buttons. Any attempt to
  call those endpoints directly returns HTTP 403.
- A read-write calendar behaves like the delegate's own calendar.

Supported CalDAV servers
------------------------

The proxy principal mechanism is supported by:

- Nextcloud (Calendar app)
- Baikal
- DAViCal
- Apple Calendar Server (original reference implementation)

Servers that implement only WebDAV ACL sharing without the proxy principal
properties (e.g. some groupware suites) are not supported by this mechanism.
Use the ``calendar.sharing`` option for ACL-based sharing where available.
