package net.bawes.universe;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * Primary Capacitor entry activity hosting the remote BAWES Universe WebView
 * and handling singleTask OAuth deep-link callbacks via {@code bawes://callback}.
 */
public class MainActivity extends BridgeActivity {

    /**
     * Initializes the Capacitor native bridge and restores saved activity state.
     *
     * @param savedInstanceState previously persisted activity bundle, or null on cold launch
     */
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }
}
