package club.exampleapp.caldaver;

import android.os.Bundle;
import club.exampleapp.caldaver.notifications.CaldaverNotificationsPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(CaldaverInstancePlugin.class);
        registerPlugin(CaldaverNotificationsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
