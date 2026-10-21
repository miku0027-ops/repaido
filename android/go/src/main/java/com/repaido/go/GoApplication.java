package com.repaido.go;
/** FCM must also initialise when Android starts the process for a background push. */
public final class GoApplication extends android.app.Application {
    @Override public void onCreate(){super.onCreate();GoFirebase.ready(this);}
}
