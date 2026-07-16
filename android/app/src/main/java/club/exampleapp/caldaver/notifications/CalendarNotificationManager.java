package club.exampleapp.caldaver.notifications;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import java.util.List;

public class CalendarNotificationManager {

    private final Context context;
    private final NotificationManager notificationManager;

    public CalendarNotificationManager(Context context) {
        this.context = context;
        this.notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    }

    public void postAlert(CalendarAlert alert) {
        if (notificationManager == null) return;
        ensureChannel(alert.getCalendarName());

        Intent tapIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (tapIntent == null) tapIntent = new Intent();
        tapIntent.putExtra("uid", alert.getUid());
        tapIntent.putExtra("startMillis", alert.getStartMillis());
        tapIntent.putExtra("endMillis", alert.getEndMillis());
        tapIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentIntent = PendingIntent.getActivity(context, 0, tapIntent, flags);

        String channelId = channelIdFor(alert.getCalendarName());
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
                .setContentTitle(alert.getTitle())
                .setContentText(formatTime(alert.getMinutes()))
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .setDefaults(NotificationCompat.DEFAULT_ALL);

        if (alert.getLocation() != null && !alert.getLocation().isEmpty()) {
            Intent mapIntent = new Intent(Intent.ACTION_VIEW);
            mapIntent.setData(android.net.Uri.parse("geo:0,0?q=" + alert.getLocation()));
            if (mapIntent.resolveActivity(context.getPackageManager()) != null) {
                PendingIntent mapPendingIntent = PendingIntent.getActivity(
                        context, 2, mapIntent, flags);
                builder.addAction(0, "Map", mapPendingIntent);
            }
        }

        notificationManager.notify((int) alert.getEventId(), builder.build());
    }

    public void postExpiredDigest(List<CalendarAlert> expired) {
        if (notificationManager == null || expired.isEmpty()) return;

        String channelId = channelIdFor("Expired events");
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
                .setContentTitle("Past events")
                .setContentText(expired.size() + " event(s) have ended")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setAutoCancel(true);

        notificationManager.notify(Integer.MAX_VALUE, builder.build());
    }

    public void dismiss(long eventId) {
        notificationManager.cancel((int) eventId);
    }

    private void ensureChannel(String calendarName) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        String channelId = channelIdFor(calendarName);
        NotificationChannel existing = notificationManager.getNotificationChannel(channelId);
        if (existing != null) return;

        NotificationChannel channel = new NotificationChannel(
                channelId, calendarName, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Reminders for " + calendarName);
        notificationManager.createNotificationChannel(channel);
    }

    private static String channelIdFor(String calendarName) {
        return "caldaver_" + calendarName.replaceAll("[^a-zA-Z0-9]", "_");
    }

    private static String formatTime(int minutes) {
        if (minutes < 60) return "In " + minutes + " min";
        if (minutes < 1440) return "In " + (minutes / 60) + " hr " + (minutes % 60) + " min";
        return "In " + (minutes / 1440) + " days";
    }
}
