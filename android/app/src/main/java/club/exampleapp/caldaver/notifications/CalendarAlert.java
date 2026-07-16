package club.exampleapp.caldaver.notifications;

import android.net.Uri;

public class CalendarAlert {
    private final long id;
    private final long eventId;
    private final String uid;
    private final String title;
    private final long startMillis;
    private final long endMillis;
    private final int minutes;
    private final boolean allDay;
    private final String location;
    private final String description;
    private final String calendarName;
    private final String calendarColor;
    private final boolean visible;
    private final boolean dismissed;
    private final String originalUri;

    public CalendarAlert(long id, long eventId, String uid, String title,
                         long startMillis, long endMillis, int minutes,
                         boolean allDay, String location, String description,
                         String calendarName, String calendarColor,
                         boolean visible, boolean dismissed, String originalUri) {
        this.id = id;
        this.eventId = eventId;
        this.uid = uid;
        this.title = title;
        this.startMillis = startMillis;
        this.endMillis = endMillis;
        this.minutes = minutes;
        this.allDay = allDay;
        this.location = location;
        this.description = description;
        this.calendarName = calendarName;
        this.calendarColor = calendarColor;
        this.visible = visible;
        this.dismissed = dismissed;
        this.originalUri = originalUri;
    }

    public long getId() { return id; }
    public long getEventId() { return eventId; }
    public String getUid() { return uid; }
    public String getTitle() { return title; }
    public long getStartMillis() { return startMillis; }
    public long getEndMillis() { return endMillis; }
    public int getMinutes() { return minutes; }
    public boolean isAllDay() { return allDay; }
    public String getLocation() { return location; }
    public String getDescription() { return description; }
    public String getCalendarName() { return calendarName; }
    public String getCalendarColor() { return calendarColor; }
    public boolean isVisible() { return visible; }
    public boolean isDismissed() { return dismissed; }
    public String getOriginalUri() { return originalUri; }
    public boolean isExpired() { return System.currentTimeMillis() > endMillis; }
    public boolean isDue() {
        long dueAt = startMillis - (minutes * 60_000L);
        return System.currentTimeMillis() >= dueAt;
    }
}
