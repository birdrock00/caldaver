package club.exampleapp.caldaver.notifications;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;

import java.util.ArrayList;
import java.util.List;

public class AndroidCalendarAlertRepository implements CalendarAlertRepository {

    private final ContentResolver contentResolver;

    public AndroidCalendarAlertRepository(Context context) {
        this.contentResolver = context.getContentResolver();
    }

    @Override
    public List<CalendarAlert> fetchVisibleAlerts() {
        List<CalendarAlert> alerts = new ArrayList<>();
        String[] calendarProjection = {
                CalendarContract.Calendars._ID,
                CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
                CalendarContract.Calendars.CALENDAR_COLOR,
                CalendarContract.Calendars.VISIBLE,
                CalendarContract.Calendars.ACCOUNT_NAME,
        };
        String calendarSelection = CalendarContract.Calendars.VISIBLE + "=1";

        try (Cursor calendarCursor = contentResolver.query(
                CalendarContract.Calendars.CONTENT_URI, calendarProjection,
                calendarSelection, null, null)) {

            if (calendarCursor == null) return alerts;

            while (calendarCursor.moveToNext()) {
                long calId = calendarCursor.getLong(0);
                String calName = calendarCursor.getString(1);
                String calColor = String.format("#%06X", 0xFFFFFF & calendarCursor.getInt(2));
                boolean visible = calendarCursor.getInt(3) == 1;

                if (!visible) continue;

                String[] eventProjection = {
                        CalendarContract.Events._ID,
                        CalendarContract.Events.TITLE,
                        CalendarContract.Events.DTSTART,
                        CalendarContract.Events.DTEND,
                        CalendarContract.Events.ALL_DAY,
                        CalendarContract.Events.EVENT_LOCATION,
                        CalendarContract.Events.DESCRIPTION,
                        CalendarContract.Events.UID_2445,
                };
                String eventSelection = CalendarContract.Events.CALENDAR_ID + "=?";

                List<String> eventIds = new ArrayList<>();
                List<Long> idList = new ArrayList<>();
                try (Cursor eventCursor = contentResolver.query(
                        CalendarContract.Events.CONTENT_URI, eventProjection,
                        eventSelection, new String[]{String.valueOf(calId)}, null)) {

                    if (eventCursor == null) continue;

                    while (eventCursor.moveToNext()) {
                        long eventId = eventCursor.getLong(0);
                        long dtstart = eventCursor.getLong(2);
                        long dtend = eventCursor.getLong(3);

                        if (dtend < System.currentTimeMillis()) continue;

                        eventIds.add(String.valueOf(eventId));
                        idList.add(eventId);
                    }
                }

                if (eventIds.isEmpty()) continue;

                String[] reminderProjection = {
                        CalendarContract.Reminders._ID,
                        CalendarContract.Reminders.EVENT_ID,
                        CalendarContract.Reminders.MINUTES,
                        CalendarContract.Reminders.METHOD,
                };
                String reminderSelection = CalendarContract.Reminders.EVENT_ID + " IN ("
                        + String.join(",", eventIds) + ")";

                try (Cursor reminderCursor = contentResolver.query(
                        CalendarContract.Reminders.CONTENT_URI, reminderProjection,
                        reminderSelection, null, null)) {

                    if (reminderCursor == null) continue;

                    while (reminderCursor.moveToNext()) {
                        long reminderId = reminderCursor.getLong(0);
                        long eventId = reminderCursor.getLong(1);
                        int minutes = reminderCursor.getInt(2);
                        int method = reminderCursor.getInt(3);

                        if (method != CalendarContract.Reminders.METHOD_ALERT) continue;

                        CalendarAlert alert = findAlertForEvent(alerts, eventId);
                        if (alert == null) {
                            String uid = "";
                            String title = "";
                            long start = 0;
                            long end = 0;
                            boolean allDay = false;
                            String location = "";
                            String description = "";
                            String originalUri = "";

                            try (Cursor ec = contentResolver.query(
                                    CalendarContract.Events.CONTENT_URI, eventProjection,
                                    CalendarContract.Events._ID + "=?",
                                    new String[]{String.valueOf(eventId)}, null)) {
                                if (ec != null && ec.moveToFirst()) {
                                    int idxTitle = ec.getColumnIndex(CalendarContract.Events.TITLE);
                                    int idxStart = ec.getColumnIndex(CalendarContract.Events.DTSTART);
                                    int idxEnd = ec.getColumnIndex(CalendarContract.Events.DTEND);
                                    int idxAllDay = ec.getColumnIndex(CalendarContract.Events.ALL_DAY);
                                    int idxLoc = ec.getColumnIndex(CalendarContract.Events.EVENT_LOCATION);
                                    int idxDesc = ec.getColumnIndex(CalendarContract.Events.DESCRIPTION);
                                    int idxUid = ec.getColumnIndex(CalendarContract.Events.UID_2445);
                                    if (idxTitle >= 0) title = ec.getString(idxTitle);
                                    if (idxStart >= 0) start = ec.getLong(idxStart);
                                    if (idxEnd >= 0) end = ec.getLong(idxEnd);
                                    if (idxAllDay >= 0) allDay = ec.getInt(idxAllDay) == 1;
                                    if (idxLoc >= 0) location = ec.getString(idxLoc);
                                    if (idxDesc >= 0) description = ec.getString(idxDesc);
                                    if (idxUid >= 0) uid = ec.getString(idxUid);
                                }
                            }

                            if (uid == null) uid = "";

                            alert = new CalendarAlert(reminderId, eventId, uid,
                                    title != null ? title : "", start, end, minutes,
                                    allDay, location != null ? location : "",
                                    description != null ? description : "",
                                    calName, calColor, true, false, originalUri != null ? originalUri : "");
                            alerts.add(alert);
                        }
                    }
                }
            }
        }
        return alerts;
    }

    private CalendarAlert findAlertForEvent(List<CalendarAlert> alerts, long eventId) {
        for (CalendarAlert alert : alerts) {
            if (alert.getEventId() == eventId) {
                return alert;
            }
        }
        return null;
    }

    @Override
    public void markDismissed(Uri eventUri, long eventId, long startMillis) {
    }

    @Override
    public void snooze(long eventId, long startMillis) {
        ContentValues values = new ContentValues();
        values.put(CalendarContract.Reminders.EVENT_ID, eventId);
        values.put(CalendarContract.Reminders.MINUTES, 10);
        values.put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT);
        contentResolver.insert(CalendarContract.Reminders.CONTENT_URI, values);
    }
}
