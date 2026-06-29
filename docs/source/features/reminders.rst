.. _reminders:

Reminders
=========

AgenDAV supports iCalendar ``VALARM`` reminders on events. A reminder triggers
a notification at a set time before the event starts. Reminders are stored
inside the event on the CalDAV server and are visible to any CalDAV client
that supports ``VALARM``.

Adding a reminder to an event
------------------------------

1. Open the event editor (create a new event or click an existing one and
   choose **Edit**).
2. In the **Reminders** section, click **Add reminder**.
3. Enter a count and choose a unit: **minutes**, **hours**, or **days**.
4. Save the event.

You can add multiple reminders to a single event by clicking **Add reminder**
again.

To remove a reminder, click the remove button next to it before saving.

Default reminder
----------------

AgenDAV can pre-fill a reminder on every new event you create. Set this in
your preferences:

1. Open **Preferences** from the top menu.
2. Under **Default reminder**, enter a count and unit.
3. Save preferences.

New events will have this reminder pre-filled in the editor. You can still
remove or change it per event. Leave the count empty to disable the default.

.. note::

   The default reminder applies only to new events created in AgenDAV. Events
   imported from other clients or existing events are not affected.

How reminders are delivered
---------------------------

AgenDAV stores reminders as ``VALARM`` components in the iCalendar data on
the CalDAV server. AgenDAV itself does not send notifications - delivery
(desktop alert, email, push notification) depends on the CalDAV client the
user also has configured, such as a desktop calendar app or a mobile client.

CalDAV clients that sync the same calendar will see and honour the same
reminders.
