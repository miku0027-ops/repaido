package com.repaido.agent;

import android.app.*;
import android.content.*;
import android.location.*;
import android.os.*;
import androidx.core.app.NotificationCompat;
import org.json.JSONObject;
import java.net.*;
import java.io.*;
import java.util.concurrent.*;

/** User-started location foreground service. Job capability stays in memory, never on disk. */
public class TrackingService extends Service implements LocationListener {
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private LocationManager locations;
    private String token;
    private long sequence = 0, lastSent = 0;
    private volatile boolean sending = false, ended = false;
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        if ("STOP".equals(intent.getAction())) {
            ended = true;
            final String oldToken = token;
            if (oldToken != null) network.execute(() -> post("stop", new JSONObject(), oldToken));
            stopSelf(); return START_NOT_STICKY;
        }
        token = intent.getStringExtra("token");
        if (token == null) { stopSelf(); return START_NOT_STICKY; }
        ended = false; sequence = 0;
        PushService.channels(this);
        PendingIntent stop = PendingIntent.getService(this, 12, new Intent(this, TrackingService.class).setAction("STOP"), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent open = PendingIntent.getActivity(this, 13, new Intent(this, AgentActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        startForeground(31, new NotificationCompat.Builder(this, "repaido_tracking").setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Repaido location sharing is on").setContentText("Sharing for your active visit. Tap Stop to end.")
            .setOngoing(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setContentIntent(open)
            .addAction(0, "Stop sharing", stop).build());
        try {
            locations = (LocationManager)getSystemService(LOCATION_SERVICE);
            locations.removeUpdates(this);
            locations.requestLocationUpdates(LocationManager.GPS_PROVIDER, 15000, 0, this);
            if (locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) locations.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 15000, 0, this);
        } catch (Exception ex) { stopSelf(); }
        handler.removeCallbacksAndMessages(null);
        handler.postDelayed(this::stopSelf, 8 * 60 * 60 * 1000L);
        return START_NOT_STICKY;
    }
    @Override public void onLocationChanged(Location location) {
        if (ended || sending || System.currentTimeMillis()-lastSent < 15000 || !location.hasAccuracy() || location.getAccuracy()>100) return;
        if (SystemClock.elapsedRealtimeNanos()-location.getElapsedRealtimeNanos()>120000000000L) return;
        try {
            JSONObject body = new JSONObject().put("lat", location.getLatitude()).put("lng", location.getLongitude())
                .put("accuracy", location.getAccuracy()).put("captured_at", location.getTime()/1000.0).put("sequence", ++sequence);
            String capability = token; sending = true; lastSent = System.currentTimeMillis();
            network.execute(() -> {
                int code = ended ? 410 : post("position", body, capability);
                sending = false;
                if (code == 401 || code == 403 || code == 410) handler.post(this::stopSelf);
            });
        } catch (Exception ignored) { }
    }
    private int post(String route, JSONObject body, String capability) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection)new URL(BuildConfig.WEB_URL+"/api/operations/tracking/"+route).openConnection();
            connection.setInstanceFollowRedirects(false); connection.setRequestMethod("POST");
            connection.setConnectTimeout(15000); connection.setReadTimeout(15000); connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type","application/json");connection.setRequestProperty("Authorization","Bearer "+capability);
            try(OutputStream output=connection.getOutputStream()){output.write(body.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));}
            return connection.getResponseCode();
        } catch(Exception ignored){return 0;} finally {if(connection!=null)connection.disconnect();}
    }
    @Override public void onDestroy() {
        ended=true;handler.removeCallbacksAndMessages(null);
        if(locations!=null)locations.removeUpdates(this);
        stopForeground(STOP_FOREGROUND_REMOVE);network.shutdown();super.onDestroy();
    }
    @Override public void onProviderDisabled(String provider) { }
    @Override public void onProviderEnabled(String provider) { }
}
