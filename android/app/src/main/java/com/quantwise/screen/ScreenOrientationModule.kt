package com.quantwise.screen

import android.content.pm.ActivityInfo
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.quantwise.specs.NativeScreenOrientationSpec

/** 全屏看表时临时切横屏或竖屏；关掉全屏后交回系统（跟随自动旋转设置）。 */
class ScreenOrientationModule(context: ReactApplicationContext) : NativeScreenOrientationSpec(context) {
  companion object {
    const val NAME = "ScreenOrientation"
  }

  override fun getName() = NAME

  override fun set(mode: String) {
    UiThreadUtil.runOnUiThread {
      val activity = reactApplicationContext.currentActivity ?: return@runOnUiThread
      activity.requestedOrientation = when (mode) {
        "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        "portrait" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
        else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
      }
    }
  }
}
