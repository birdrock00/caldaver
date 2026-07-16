package club.exampleapp.caldaver.notifications;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.CalendarContract;
import android.util.Log;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class CalendarReminderReceiver extends BroadcastReceiver {

    private static final String TAG = "CaldaverReminder";
    private static final String FALLBACK_ACTION = "club.exampleapp.caldaver.action.FALLBACK_REMINDER";
    private static final ExecutorService executor = Executors.newFixedThreadPool(2);
    private static volatile boolean providerSeen = false;

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (action == null) return;

        final PendingResult pendingResult = goAsync();
        executor.execute(() -> {
            try {
                handleIntent(context, intent, action);
            } finally {
                if (pendingResult != null) {
                    pendingResult.finish();
                }
            }
        });
    }

    private void handleIntent(Context context, Intent intent, String action) {
        switch (action) {
            case CalendarContract.ACTION_EVENT_REMINDER:
            case "android.provider.calendar.PROVIDER_CHANGED":
                providerSeen = true;
                CalendarAlertRepository repository = new AndroidCalendarAlertRepository(context);
                CalendarNotificationManager notificationManager = new CalendarNotificationManager(context);
                AlertClassifier classifier = new AlertClassifier();
                CalendarAlertScheduler scheduler = new CalendarAlertScheduler(context);
                NotificationPresenter presenter = new NotificationPresenter(repository, notificationManager, classifier, scheduler);
                presenter.present();
                break;
            case Intent.ACTION_TIME_CHANGED:
            case Intent.ACTION_DATE_CHANGED:
            case Intent.ACTION_BOOT_COMPLETED:
            case Intent.ACTION_MY_PACKAGE_REPLACED:
                providerSeen = false;
                scheduleFallback(context);
                CalendarAlertRepository repo = new AndroidCalendarAlertRepository(context);
                CalendarNotificationManager nm = new CalendarNotificationManager(context);
                AlertClassifier ac = new AlertClassifier();
                CalendarAlertScheduler cs = new CalendarAlertScheduler(context);
                NotificationPresenter p = new NotificationPresenter(repo, nm, ac, cs);
                p.present();
                break;
            case FALLBACK_ACTION:
                if (!providerSeen) {
                    CalendarAlertRepository fallbackRepo = new AndroidCalendarAlertRepository(context);
                    CalendarNotificationManager fallbackNm = new CalendarNotificationManager(context);
                    AlertClassifier fallbackAc = new AlertClassifier();
                    CalendarAlertScheduler fallbackCs = new CalendarAlertScheduler(context);
                    NotificationPresenter fp = new NotificationPresenter(fallbackRepo, fallbackNm, fallbackAc, fallbackCs);
                    fp.present();
                }
                break;
        }
    }

    private void scheduleFallback(Context context) {
        Intent intent = new Intent(FALLBACK_ACTION);
        intent.setPackage(context.getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getBroadcast(context, 0, intent, flags);
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
                return;
            }
            alarmManager.setExact(AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    android.os.SystemClock.elapsedRealtime() + 30000, pendingIntent);
        }
    }

    public static void scheduleNextAlert(Context context, long triggerAtMillis) {
        Intent intent = new Intent(CalendarContract.ACTION_EVENT_REMINDER);
        intent.setPackage(context.getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getBroadcast(context, 1, intent, flags);
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
                return;
            }
            alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAtMillis, pendingIntent);
        }
    }
}
