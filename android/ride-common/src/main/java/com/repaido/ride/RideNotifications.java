package com.repaido.ride;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.util.Map;

public final class RideNotifications {
    public static final String CHANNEL="repaido_ride_alerts_v1", EXTRA="repaido_ride_path";
    public static void clear(Context context) {
        NotificationManager manager=context.getSystemService(NotificationManager.class);
        for (android.service.notification.StatusBarNotification item:manager.getActiveNotifications())
            if (CHANNEL.equals(item.getNotification().getChannelId())) manager.cancel(item.getTag(),item.getId());
    }
    public static synchronized void bind(Context context,String uid) {
        SharedPreferences prefs=context.getSharedPreferences("repaido_ride_session",Context.MODE_PRIVATE);
        if (!prefs.getString("uid","").equals(uid)) { clear(context); prefs.edit().clear().putString("uid",uid).apply(); }
    }
    public static String account(Context context) { return context.getSharedPreferences("repaido_ride_session",Context.MODE_PRIVATE).getString("uid",""); }
    public static synchronized boolean show(Context context,Class<?> activity,Map<String,String> data) {
        if (!"ride".equals(data.get("destination"))) return false;
        RidePushTarget target=RidePushTarget.parse(data,account(context),System.currentTimeMillis()/1000);
        if (target==null || !NotificationManagerCompat.from(context).areNotificationsEnabled()) return true;
        if (Build.VERSION.SDK_INT>=33 && ContextCompat.checkSelfPermission(context,Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) return true;
        SharedPreferences prefs=context.getSharedPreferences("repaido_ride_session",Context.MODE_PRIVATE);
        String key="version:"+target.id;
        // Persist the highest version. Delayed/repeated FCM deliveries never ring twice.
        if (prefs.getLong(key,0)>=target.version) return true;
        if (prefs.getAll().size()>240) {
            long now=System.currentTimeMillis()/1000;
            SharedPreferences.Editor clean=prefs.edit();
            for(String entry:prefs.getAll().keySet()) if(entry.startsWith("expiry:")&&prefs.getLong(entry,0)<now) { clean.remove(entry);clean.remove("version:"+entry.substring(7)); }
            clean.apply();
        }
        prefs.edit().putLong(key,target.version).putLong("expiry:"+target.id,target.expires+86400).apply();
        NotificationManager manager=context.getSystemService(NotificationManager.class);
        NotificationChannel channel=new NotificationChannel(CHANNEL,"Ride requests & pickup updates",NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Ride updates only. Sound and vibration follow your Android settings.");
        channel.setSound(Uri.parse("android.resource://"+context.getPackageName()+"/raw/repaido_task_bell"),new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
        channel.enableVibration(true);channel.setVibrationPattern(new long[]{0,200,120,200});channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(channel);
        Intent open=new Intent(context,activity).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA,target.path()).putExtra("repaido_ride_account",target.recipient);
        PendingIntent tap=PendingIntent.getActivity(context,target.id.hashCode(),open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        String body=target.alert.equals("request")?"Open Go Driver to accept or reject before it expires.":target.alert.equals("arrival")?"Your rider is waiting. Open your ride to meet at pickup.":"Open your ride for the latest confirmed details.";
        Notification notification=new NotificationCompat.Builder(context,CHANNEL).setSmallIcon(android.R.drawable.ic_menu_directions)
            .setContentTitle(target.title()).setContentText(body).setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setColor(0xFFFBBC04).setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_EVENT)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setOnlyAlertOnce(false).setAutoCancel(true)
            .setTimeoutAfter(Math.max(1,target.expires*1000-System.currentTimeMillis())).setContentIntent(tap).build();
        manager.notify("ride:"+target.id,1,notification);
        return true;
    }
    public static String pathFromIntent(Context context,Intent intent) {
        String path=intent.getStringExtra(EXTRA),uid=intent.getStringExtra("repaido_ride_account");
        if (uid==null || uid.isEmpty() || !uid.equals(account(context)) || path==null) return null;
        return path.matches("/go\\?ride=(bike|cab)&(bike|cab)-ride=[a-f0-9]{64}") || path.matches("/go\\?ride=(bike|cab)&view=rides&(bike-ride|ride-booking)=[a-f0-9]{64}") || path.matches("/worker\\?mode=(driver|cab_owner)&tab=(bikes|journeys)&(bike|cab)-ride=[a-f0-9]{64}(&ride-history=1)?")?path:null;
    }
}
