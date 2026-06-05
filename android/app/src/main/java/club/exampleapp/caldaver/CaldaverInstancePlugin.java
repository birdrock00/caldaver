package club.exampleapp.caldaver;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

@CapacitorPlugin(name = "CaldaverInstance")
public class CaldaverInstancePlugin extends Plugin {

    private static final String PREFS_NAME = "caldaver_android";
    private static final String PREF_SERVER_URL = "server_url";

    @PluginMethod
    public void get(PluginCall call) {
        JSObject response = new JSObject();
        response.put("url", normalizedSavedServerUrl());
        call.resolve(response);
    }

    @PluginMethod
    public void set(PluginCall call) {
        String normalized = normalizeServerUrl(call.getString("url", ""));
        if (normalized.isEmpty()) {
            call.reject("Caldaver instance URL must be an HTTPS URL.");
            return;
        }

        preferences().edit().putString(PREF_SERVER_URL, normalized).apply();
        JSObject response = new JSObject();
        response.put("url", normalized);
        call.resolve(response);
    }

    @PluginMethod
    public void clearAndShowSetup(PluginCall call) {
        preferences().edit().remove(PREF_SERVER_URL).apply();
        call.resolve();

        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) {
            return;
        }

        String setupUrl = bridge.getLocalUrl();
        if (setupUrl == null || setupUrl.isEmpty()) {
            return;
        }

        getActivity().runOnUiThread(() -> bridge.getWebView().loadUrl(setupUrl));
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private String normalizedSavedServerUrl() {
        String stored = preferences().getString(PREF_SERVER_URL, "");
        String normalized = normalizeServerUrl(stored);

        if (!normalized.equals(stored)) {
            SharedPreferences.Editor editor = preferences().edit();
            if (normalized.isEmpty()) {
                editor.remove(PREF_SERVER_URL);
            } else {
                editor.putString(PREF_SERVER_URL, normalized);
            }
            editor.apply();
        }

        return normalized;
    }

    private static String normalizeServerUrl(String value) {
        String trimmed = value == null ? "" : value.trim();
        if (trimmed.isEmpty()) {
            return "";
        }

        if (!trimmed.matches("(?i)^[a-z][a-z0-9+.-]*://.*")) {
            trimmed = "https://" + trimmed;
        }

        try {
            URI uri = new URI(trimmed);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.US);
            String host = uri.getHost();

            if (!scheme.equals("https") || host == null || host.isEmpty()) {
                return "";
            }

            if (uri.getUserInfo() != null && !uri.getUserInfo().isEmpty()) {
                return "";
            }

            StringBuilder normalized = new StringBuilder();
            normalized.append(scheme).append("://").append(host.toLowerCase(Locale.US));
            if (uri.getPort() != -1) {
                normalized.append(":").append(uri.getPort());
            }

            String path = uri.getRawPath();
            if (path != null && !path.isEmpty() && !path.equals("/")) {
                String normalizedPath = path.replaceAll("/+$", "");
                if (!normalizedPath.isEmpty()) {
                    normalized.append(normalizedPath);
                }
            }

            return normalized.toString();
        } catch (URISyntaxException error) {
            return "";
        }
    }
}
