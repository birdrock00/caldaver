package club.exampleapp.caldaver.notifications;

import java.util.ArrayList;
import java.util.List;

public class AlertClassifier {

    private static final int MAX_INDIVIDUAL = 20;

    public ClassificationResult classify(List<CalendarAlert> alerts) {
        List<CalendarAlert> current = new ArrayList<>();
        List<CalendarAlert> expired = new ArrayList<>();

        for (CalendarAlert alert : alerts) {
            if (!alert.isVisible()) continue;
            if (alert.isDismissed()) continue;

            if (alert.isDue() && !alert.isExpired()) {
                if (current.size() < MAX_INDIVIDUAL) {
                    current.add(alert);
                }
            } else if (alert.isExpired()) {
                expired.add(alert);
            }
        }

        return new ClassificationResult(current, expired);
    }

    public static class ClassificationResult {
        private final List<CalendarAlert> current;
        private final List<CalendarAlert> expired;

        ClassificationResult(List<CalendarAlert> current, List<CalendarAlert> expired) {
            this.current = current;
            this.expired = expired;
        }

        public List<CalendarAlert> getCurrent() { return current; }
        public List<CalendarAlert> getExpired() { return expired; }
        public boolean hasCurrent() { return !current.isEmpty(); }
        public boolean hasExpired() { return !expired.isEmpty(); }
    }
}
