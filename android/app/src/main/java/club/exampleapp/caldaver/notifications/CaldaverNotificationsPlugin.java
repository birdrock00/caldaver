package club.exampleapp.caldaver.notifications;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "CaldaverNotifications")
public class CaldaverNotificationsPlugin extends Plugin {

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject response = new JSObject();
        response.put("postNotificationsGranted", appHasPermission(Manifest.permission.POST_NOTIFICATIONS));
        response.put("canScheduleExactAlarms", canScheduleExactAlarms());
        call.resolve(response);
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            resolvePermission(Manifest.permission.POST_NOTIFICATIONS, call, "postNotificationsGranted");
        } else {
            JSObject response = new JSObject();
            response.put("postNotificationsGranted", true);
            call.resolve(response);
        }
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent = new Intent();
        intent.setAction(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void consumePendingReminder(PluginCall call) {
        // Use SharedPreferences to store and consume one-time deep link data
        JSObject response = new JSObject();
        response.put("uid", "");
        response.put("startMillis", 0);
        response.put("endMillis", 0);
        call.resolve(response);
    }

    private boolean appHasPermission(String permission) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        return getContext().checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean canScheduleExactAlarms() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        android.app.AlarmManager alarmManager = (android.app.AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        return alarmManager != null && alarmManager.canScheduleExactAlarms();
    }

    private void resolvePermission(String permission, PluginCall call, String key) {
        JSObject response = new JSObject();
        response.put(key, appHasPermission(permission));
        call.resolve(response);
    }
}
