package com.repaido.agent;

import android.app.*;
import android.content.*;
import android.os.Build;
import android.media.AudioAttributes;
import android.net.Uri;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import androidx.core.app.NotificationCompat;

public class PushService extends FirebaseMessagingService {
    static volatile boolean appVisible = false;
    static void dismissRequestNotifications(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        for (android.service.notification.StatusBarNotification entry : manager.getActiveNotifications()) {
            if ("repaido_requests_v2".equals(entry.getNotification().getChannelId())) {
                manager.cancel(entry.getTag(), entry.getId());
            }
        }
    }
    static void channels(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("repaido_tasks", "Task updates", NotificationManager.IMPORTANCE_HIGH));
        NotificationChannel requests = new NotificationChannel("repaido_requests_v2", "Incoming task requests", NotificationManager.IMPORTANCE_HIGH);
        requests.setDescription("Time-limited task offers. Sound respects your notification volume and Do Not Disturb settings.");
        requests.setSound(Uri.parse("android.resource://"+context.getPackageName()+"/raw/repaido_task_bell"), new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        requests.enableVibration(true);
        requests.setVibrationPattern(new long[]{0,350,150,350,150,350});
        requests.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(requests);
        manager.createNotificationChannel(new NotificationChannel("repaido_tracking", "Location sharing", NotificationManager.IMPORTANCE_LOW));
    }
    @Override public void onMessageReceived(RemoteMessage message) {
        channels(this);
        boolean arrival = "arrival".equals(message.getData().get("alert_kind"));
        boolean request = arrival || "assignment".equals(message.getData().get("alert_kind")) || "hiring".equals(message.getData().get("alert_kind"));
        long expires = 0;
        try { expires = Long.parseLong(message.getData().get("expires_at")); } catch(Exception ignored) { }
        if (request && expires*1000 <= System.currentTimeMillis()) return;
        Intent open = new Intent(this, AgentActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra("destination", message.getData().get("destination"));
        open.putExtra("plan_id", message.getData().get("plan_id"));
        String id = message.getData().get("notification_id");
        PendingIntent content = PendingIntent.getActivity(this, id == null ? 1 : id.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(this, request ? "repaido_requests_v2" : "repaido_tasks")
            .setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(arrival ? "You are almost there" : request ? "New task request — respond now" : "Repaido task update")
            .setContentText(arrival ? "Arrival area reached. Continue with customer verification." : request ? "Open the Agent app to accept or decline." : "Open Repaido to view your latest task update.")
            .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_EVENT)
            .setTimeoutAfter(request ? Math.max(1, expires*1000-System.currentTimeMillis()) : 86400000)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setOnlyAlertOnce(true).setAutoCancel(true).setContentIntent(content).build();
        // Repeat the request bell until opened/dismissed or the server deadline expires.
        // Notification-channel volume and DND remain controlled by Android.
        // Foreground offers use the web bell, which stops as soon as the request is handled.
        if (request && !appVisible) n.flags |= Notification.FLAG_INSISTENT;
        getSystemService(NotificationManager.class).notify(id == null ? 1 : id.hashCode(), n);
    }
    // FCM rotates tokens. The authenticated web session re-registers the current token on resume.
}
