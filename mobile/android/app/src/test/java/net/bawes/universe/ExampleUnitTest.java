package net.bawes.universe;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import org.junit.Test;

/**
 * Host-side JUnit test suite validating the BAWES Universe Android shell manifest,
 * deep-link callback intent filter, and WebRTC media permissions.
 */
public class ExampleUnitTest {

    /**
     * Verifies baseline JUnit host test runner execution.
     */
    @Test
    public void addition_isCorrect() {
        assertEquals(4, 2 + 2);
    }

    /**
     * Verifies that AndroidManifest.xml configures hardware acceleration, landscape
     * orientation, the bawes://callback deep-link filter, and WebRTC media permissions.
     *
     * @throws Exception if the manifest file cannot be read from the module source tree
     */
    @Test
    public void manifestDeclaresDeepLinkAndMediaPermissions() throws Exception {
        Path manifestPath = Paths.get("src/main/AndroidManifest.xml");
        if (!Files.exists(manifestPath)) {
            manifestPath = Paths.get("app/src/main/AndroidManifest.xml");
        }
        String manifest = new String(Files.readAllBytes(manifestPath), StandardCharsets.UTF_8);
        assertTrue(manifest.contains("android:hardwareAccelerated=\"true\""));
        assertTrue(manifest.contains("android:screenOrientation=\"sensorLandscape\""));
        assertTrue(manifest.contains("android:scheme=\"bawes\""));
        assertTrue(manifest.contains("android:host=\"callback\""));
        assertTrue(manifest.contains("android.permission.CAMERA"));
        assertTrue(manifest.contains("android.permission.RECORD_AUDIO"));
        assertTrue(manifest.contains("android.permission.MODIFY_AUDIO_SETTINGS"));
        assertTrue(manifest.contains("android.permission.INTERNET"));
    }
}
