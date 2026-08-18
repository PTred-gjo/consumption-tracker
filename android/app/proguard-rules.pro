# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Capacitor resolves plugins and their methods reflectively by name, so R8 has
# no way to see they are used and would strip them from a release build.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public *;
}

# The bridge exposes these to JavaScript through addJavascriptInterface.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Plugins used by this app.
-keep class com.capacitorjs.plugins.localnotifications.** { *; }
-keep class com.capacitorjs.plugins.filesystem.** { *; }

# Cordova plugin shim that Capacitor loads by reflection.
-keep class org.apache.cordova.** { *; }

# Keep annotations R8 needs to read the rules above.
-keepattributes *Annotation*, JavascriptInterface

# Line numbers make a Play Console crash report readable; the source file name
# is renamed so it does not leak paths.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
