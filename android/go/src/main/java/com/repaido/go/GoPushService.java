package com.repaido.go;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import com.repaido.ride.RideNotifications;

public final class GoPushService extends FirebaseMessagingService {
    @Override public void onMessageReceived(RemoteMessage message) { RideNotifications.show(this,GoActivity.class,message.getData()); }
    @Override public void onNewToken(String token) {
        // Tokens are registered only by the authenticated web session on resume.
        getSharedPreferences("go",MODE_PRIVATE).edit().putBoolean("token_changed",true).apply();
    }
}
