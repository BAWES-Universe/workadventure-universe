package net.bawes.universe;

import static org.junit.Assert.assertEquals;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Instrumented test suite executing on an Android device or emulator to verify
 * the packaged application context and package identifier.
 */
@RunWith(AndroidJUnit4.class)
public class ExampleInstrumentedTest {

    /**
     * Verifies that the instrumented target context resolves to {@code net.bawes.universe}.
     */
    @Test
    public void useAppContext() {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("net.bawes.universe", appContext.getPackageName());
    }
}
