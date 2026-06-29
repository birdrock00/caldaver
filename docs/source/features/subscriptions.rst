.. _subscriptions:

ICS feed subscriptions
======================

AgenDAV can display external iCal feeds as read-only calendars in the sidebar.
This lets users follow public calendars - national holidays, sports schedules,
team shared calendars published as `.ics` URLs - without leaving AgenDAV.

Subscribed calendars are stored in the AgenDAV database, not on the CalDAV
server. They are read-only: events from the feed cannot be edited or deleted.

Enabling subscriptions
----------------------

Subscriptions are disabled by default. Enable them in ``config/settings.php``::

    $app['calendar.subscriptions'] = true;

.. warning::

   When a user adds a subscription, AgenDAV fetches the iCal URL from the
   **server**, not from the user's browser. This creates an SSRF risk: a
   malicious user could supply an internal URL and probe services on your
   network that are normally unreachable from the outside.

   Only enable subscriptions if:

   - your AgenDAV instance is not reachable by untrusted users, **or**
   - AgenDAV runs in an isolated network where it cannot reach internal services.

   Only ``http://`` and ``https://`` URLs are accepted.

Adding a subscription (user)
-----------------------------

1. Click the **+** button next to "Calendars" in the sidebar.
2. Select **Subscribe to iCal feed**.
3. Paste the `.ics` URL into the URL field.
4. Choose a display name and colour.
5. Click **Save**.

The feed appears in the sidebar immediately. Its events are refreshed each
time the calendar view loads.

Example: subscribing to a Nextcloud shared calendar
----------------------------------------------------

Nextcloud can publish any calendar as a public iCal feed.

1. In the Nextcloud Calendar app, open the three-dot menu of the calendar.
2. Choose **Copy public link**.
3. In AgenDAV, add a new iCal subscription and paste that link.

The calendar will appear read-only in AgenDAV. Changes made in Nextcloud
are reflected on the next page load.

Example: subscribing to a public holiday calendar
--------------------------------------------------

Many providers publish `.ics` holiday feeds, for example::

    https://calendar.google.com/calendar/ical/en.german%23holiday%40group.v.calendar.google.com/public/basic.ics

Paste the URL directly into the subscription dialog. No authentication is
supported for external feeds - the URL must be publicly accessible.

Removing a subscription
------------------------

Open the calendar's context menu in the sidebar and choose **Delete**. This
removes the subscription from the AgenDAV database. It does not affect the
original iCal feed or its source.
