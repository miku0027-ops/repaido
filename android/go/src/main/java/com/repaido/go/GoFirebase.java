package com.repaido.go;
import android.content.Context;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;

final class GoFirebase {
    static boolean ready(Context context) {
        if(BuildConfig.FIREBASE_APP_ID.isEmpty() || BuildConfig.FIREBASE_API_KEY.isEmpty()) return false;
        if(FirebaseApp.getApps(context).isEmpty()) FirebaseApp.initializeApp(context,new FirebaseOptions.Builder()
            .setApplicationId(BuildConfig.FIREBASE_APP_ID).setApiKey(BuildConfig.FIREBASE_API_KEY)
            .setProjectId(BuildConfig.FIREBASE_PROJECT_ID).setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID).build());
        return true;
    }
}
