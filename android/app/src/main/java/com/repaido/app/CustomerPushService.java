package com.repaido.app;

import android.app.*;
import android.content.*;
import android.media.AudioAttributes;
import android.net.Uri;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import androidx.core.app.NotificationCompat;
import java.util.*;

public class CustomerPushService extends FirebaseMessagingService {
    static void channels(Context context) {
        NotificationManager manager=context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("repaido_tasks","Task updates",NotificationManager.IMPORTANCE_HIGH));
        NotificationChannel arrivals=new NotificationChannel("repaido_requests_v2","Arrival alerts",NotificationManager.IMPORTANCE_HIGH);
        arrivals.setSound(Uri.parse("android.resource://"+context.getPackageName()+"/raw/repaido_task_bell"),new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build());
        arrivals.enableVibration(true);arrivals.setVibrationPattern(new long[]{0,350,150,350,150,350});manager.createNotificationChannel(arrivals);
        manager.createNotificationChannel(new NotificationChannel("repaido_offers","Optional offers & suggestions",NotificationManager.IMPORTANCE_DEFAULT));
    }
    @Override public void onMessageReceived(RemoteMessage message) {
        channels(this);
        Map<String,String> data=message.getData();
        boolean arrival="arrival".equals(data.get("alert_kind"));
        if(arrival){try{if(Long.parseLong(data.getOrDefault("expires_at","0"))<=System.currentTimeMillis()/1000)return;}catch(Exception e){return;}}
        boolean promo="promotion".equals(data.get("destination"));
        String id=data.get("notification_id");
        SharedPreferences prefs=getSharedPreferences("repaido_offers",MODE_PRIVATE);
        if(promo){
            long expires;try{expires=Long.parseLong(data.getOrDefault("expires_at","0"));}catch(Exception e){return;}
            Calendar india=Calendar.getInstance(TimeZone.getTimeZone("Asia/Kolkata"));int hour=india.get(Calendar.HOUR_OF_DAY);
            if(!prefs.getBoolean("enabled",false)||expires<=System.currentTimeMillis()/1000||hour<8||hour>=23||id==null)return;
            Set<String> seen=new HashSet<>(prefs.getStringSet("seen",Collections.emptySet()));if(seen.contains(id))return;
            if(seen.size()>100)seen.clear();seen.add(id);prefs.edit().putStringSet("seen",seen).apply();
        }
        Intent open=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra("job_id",data.get("job_id"));open.putExtra("campaign_id",data.get("campaign_id"));open.putExtra("plan_id",data.get("plan_id"));
        PendingIntent content=PendingIntent.getActivity(this,id==null?0:id.hashCode(),open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        String title=arrival?"Your professional is almost there":promo?data.getOrDefault("title","Repaido offer"):"Repaido task update";
        String body=arrival?"Open your booking to complete arrival verification.":promo?data.getOrDefault("body","Explore available offers in Repaido."):"Open Repaido to view your latest task update.";
        Notification n=new NotificationCompat.Builder(this,arrival?"repaido_requests_v2":promo?"repaido_offers":"repaido_tasks")
            .setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title).setContentText(body)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setAutoCancel(true).setContentIntent(content).build();
        getSystemService(NotificationManager.class).notify(id==null?1:id.hashCode(),n);
    }
}
