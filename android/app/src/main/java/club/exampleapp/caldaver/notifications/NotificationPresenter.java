package club.exampleapp.caldaver.notifications;

import java.util.List;

public class NotificationPresenter {

    private final CalendarAlertRepository repository;
    private final CalendarNotificationManager notificationManager;
    private final AlertClassifier classifier;
    private final CalendarAlertScheduler scheduler;

    public NotificationPresenter(CalendarAlertRepository repository,
                                  CalendarNotificationManager notificationManager,
                                  AlertClassifier classifier,
                                  CalendarAlertScheduler scheduler) {
        this.repository = repository;
        this.notificationManager = notificationManager;
        this.classifier = classifier;
        this.scheduler = scheduler;
    }

    public void present() {
        List<CalendarAlert> alerts = repository.fetchVisibleAlerts();
        AlertClassifier.ClassificationResult result = classifier.classify(alerts);

        for (CalendarAlert alert : result.getCurrent()) {
            notificationManager.postAlert(alert);
        }

        if (result.hasExpired()) {
            notificationManager.postExpiredDigest(result.getExpired());
        }

        long nextTrigger = findNextTrigger(alerts);
        if (nextTrigger > 0) {
            scheduler.scheduleNext(nextTrigger);
        }
    }

    private long findNextTrigger(List<CalendarAlert> alerts) {
        long now = System.currentTimeMillis();
        long nearest = Long.MAX_VALUE;

        for (CalendarAlert alert : alerts) {
            if (alert.isDismissed() || !alert.isVisible()) continue;
            long dueAt = alert.getStartMillis() - (alert.getMinutes() * 60_000L);
            if (dueAt > now && dueAt < nearest) {
                nearest = dueAt;
            }
        }

        return nearest == Long.MAX_VALUE ? -1 : nearest;
    }
}
