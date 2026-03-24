package com.claudevoicebridge

import android.view.KeyEvent
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "ClaudeVoiceBridge"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  /**
   * Intercept hardware key events from Bluetooth remotes.
   * MediaSession alone isn't reliable for all BT shutter remotes,
   * so we also catch media keys here at the Activity level.
   */
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (event.action == KeyEvent.ACTION_DOWN) {
      val module = RemoteButtonModule.instance
      if (module != null && module.isEnabled() && RemoteButtonModule.isMediaKey(event.keyCode)) {
        module.emitButtonPress(event.keyCode)
        return true // consumed — don't let it change volume or trigger media player
      }
    }
    return super.dispatchKeyEvent(event)
  }

}
