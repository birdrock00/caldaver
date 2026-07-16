package club.exampleapp.caldaver.notifications;

import android.net.Uri;

import java.util.List;

public interface CalendarAlertRepository {
    List<CalendarAlert> fetchVisibleAlerts();
    void markDismissed(Uri eventUri, long eventId, long startMillis);
    void snooze(long eventId, long startMillis);
}
