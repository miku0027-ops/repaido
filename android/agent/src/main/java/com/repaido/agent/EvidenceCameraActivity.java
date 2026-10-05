package com.repaido.agent;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.hardware.Camera;
import android.location.*;
import android.media.ExifInterface;
import android.os.*;
import android.view.*;
import android.widget.*;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import org.json.JSONObject;
import java.io.*;
import java.text.SimpleDateFormat;
import java.util.*;

/** Dedicated in-app camera. No gallery import and no public media storage. */
@SuppressWarnings("deprecation")
public class EvidenceCameraActivity extends Activity implements SurfaceHolder.Callback, LocationListener {
    private Camera camera; private SurfaceView preview; private LocationManager locations;
    private Location fix; private Button capture; private TextView status; private JSONObject session;
    private boolean taking=false; private final Handler handler=new Handler(Looper.getMainLooper());
    private final Runnable freshness=new Runnable(){public void run(){updateStatus();handler.postDelayed(this,1000);}};
    @Override public void onCreate(Bundle state){
        super.onCreate(state);getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        try{session=new JSONObject(getIntent().getStringExtra("session"));}catch(Exception e){finish();return;}
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(20,20,20,20);root.setBackgroundColor(Color.WHITE);
        TextView title=new TextView(this);title.setText("Repaido • "+session.optString("kind")+" photo\n"+session.optString("task_name"));title.setTextSize(18);title.setTextColor(Color.rgb(11,19,43));root.addView(title);
        TextView notice=new TextView(this);notice.setText("Capture only the work area. Date, time, GPS, task and customer reference will be included. Photos are private to this task and expire after 30 days. Avoid people, identity documents and bank details.");notice.setTextSize(14);root.addView(notice);
        preview=new SurfaceView(this);preview.setContentDescription("Live rear camera preview");root.addView(preview,new LinearLayout.LayoutParams(-1,0,1));preview.getHolder().addCallback(this);
        status=new TextView(this);status.setTextSize(16);status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);root.addView(status);
        capture=new Button(this);capture.setText("Capture and use this photo");capture.setMinHeight(56);capture.setEnabled(false);capture.setOnClickListener(v->take());root.addView(capture);
        Button cancel=new Button(this);cancel.setText("Cancel capture");cancel.setOnClickListener(v->finish());root.addView(cancel);setContentView(root);
        locations=(LocationManager)getSystemService(LOCATION_SERVICE);
        if(!permitted())ActivityCompat.requestPermissions(this,new String[]{Manifest.permission.CAMERA,Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},201);
    }
    private boolean permitted(){return ContextCompat.checkSelfPermission(this,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED&&ContextCompat.checkSelfPermission(this,Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED;}
    private boolean fresh(){return fix!=null&&!fix.isFromMockProvider()&&fix.hasAccuracy()&&fix.getAccuracy()<=50&&(SystemClock.elapsedRealtimeNanos()-fix.getElapsedRealtimeNanos())/1000000000L<120;}
    private void updateStatus(){
        boolean valid=fresh();capture.setEnabled(valid&&camera!=null&&!taking);
        String label=!permitted()?"Camera and precise location permissions are required. Enable them in Android settings and reopen the camera.":valid?"GPS ready • accuracy ±"+Math.round(fix.getAccuracy())+" m":"Waiting for precise GPS. Enable precise location and move near the entrance if needed.";
        if(!status.getText().toString().equals(label))status.setText(label);
    }
    @Override public void onResume(){super.onResume();if(permitted()){startLocation();open();}handler.post(freshness);}
    private void startLocation(){try{locations.requestLocationUpdates(LocationManager.GPS_PROVIDER,1000,0,this);if(locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER))locations.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,1000,0,this);}catch(Exception e){status.setText("Location unavailable. Enable GPS and reopen the camera.");}}
    private void open(){if(camera!=null||!permitted()||!preview.getHolder().getSurface().isValid())return;try{
        camera=Camera.open();Camera.Parameters params=camera.getParameters();
        Camera.Size chosen=null;for(Camera.Size size:params.getSupportedPictureSizes()){if(size.width<=1920&&(chosen==null||size.width>chosen.width))chosen=size;}
        if(chosen!=null)params.setPictureSize(chosen.width,chosen.height);
        if(params.getSupportedFocusModes().contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE))params.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
        params.setRotation(90);camera.setParameters(params);camera.setDisplayOrientation(90);camera.setPreviewDisplay(preview.getHolder());camera.startPreview();
    }catch(Exception e){close();status.setText("Camera unavailable. Close other camera apps and retry.");}}
    private void take(){if(!fresh()||camera==null||taking)return;taking=true;capture.setEnabled(false);final Location captured=new Location(fix);final long at=System.currentTimeMillis();
        try{camera.takePicture(null,null,(data,c)->new Thread(()->save(data,captured,at)).start());}catch(Exception e){taking=false;status.setText("Capture failed. Reopen the camera to retry.");}
    }
    private void save(byte[] data,Location position,long at){File file=null;try{
        BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(data,0,data.length,options);options.inJustDecodeBounds=false;options.inSampleSize=Math.max(1,Math.max(options.outWidth,options.outHeight)/1280);
        Bitmap original=BitmapFactory.decodeByteArray(data,0,data.length,options);
        ExifInterface source=new ExifInterface(new ByteArrayInputStream(data));int orientation=source.getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL);Matrix matrix=new Matrix();
        if(orientation==ExifInterface.ORIENTATION_ROTATE_90)matrix.postRotate(90);else if(orientation==ExifInterface.ORIENTATION_ROTATE_180)matrix.postRotate(180);else if(orientation==ExifInterface.ORIENTATION_ROTATE_270)matrix.postRotate(270);
        Bitmap photo=Bitmap.createBitmap(original,0,0,original.getWidth(),original.getHeight(),matrix,true);
        float textSize=Math.max(16,photo.getWidth()/40f);int line=(int)(textSize*1.6f);int footer=line*8;
        Bitmap stamped=Bitmap.createBitmap(photo.getWidth(),photo.getHeight()+footer,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(stamped);canvas.drawColor(Color.rgb(11,19,43));canvas.drawBitmap(photo,0,0,null);Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);paint.setColor(Color.WHITE);paint.setTextSize(textSize);
        SimpleDateFormat date=new SimpleDateFormat("yyyy-MM-dd HH:mm:ss 'UTC'",Locale.US);date.setTimeZone(TimeZone.getTimeZone("UTC"));
        String[] lines={"REPAIDO • "+session.getString("kind").toUpperCase(Locale.US)+" • "+date.format(new Date(at)),"Task: "+session.getString("task_name"),"ID: "+session.getString("job_id"),"Visit: "+session.getString("visit_id"),"Customer: "+session.getString("customer_name"),String.format(Locale.US,"GPS: %.6f, %.6f • accuracy ±%.0f m",position.getLatitude(),position.getLongitude(),position.getAccuracy()),"Capture: "+session.getString("id")};
        for(int i=0;i<lines.length;i++){String text=lines[i];float size=textSize;while(paint.measureText(text)>photo.getWidth()-24&&size>10){size--;paint.setTextSize(size);}canvas.drawText(text,12,photo.getHeight()+line*(i+1),paint);paint.setTextSize(textSize);}
        JSONObject metadata=new JSONObject().put("source","repaido_camera_v1").put("lat",position.getLatitude()).put("lng",position.getLongitude()).put("accuracy",position.getAccuracy()).put("captured_at",at/1000.0);
        JSONObject embedded=new JSONObject(metadata.toString()).put("job_id",session.getString("job_id")).put("visit_id",session.getString("visit_id")).put("task_name",session.getString("task_name")).put("customer_name",session.getString("customer_name")).put("capture_id",session.getString("id"));
        file=new File(getCacheDir(),"repaido-evidence-"+session.getString("id")+".jpg");try(FileOutputStream out=new FileOutputStream(file)){stamped.compress(Bitmap.CompressFormat.JPEG,85,out);}
        ExifInterface exif=new ExifInterface(file.getAbsolutePath());exif.setAttribute(ExifInterface.TAG_GPS_LATITUDE,gps(position.getLatitude()));exif.setAttribute(ExifInterface.TAG_GPS_LATITUDE_REF,position.getLatitude()<0?"S":"N");exif.setAttribute(ExifInterface.TAG_GPS_LONGITUDE,gps(position.getLongitude()));exif.setAttribute(ExifInterface.TAG_GPS_LONGITUDE_REF,position.getLongitude()<0?"W":"E");exif.setAttribute(ExifInterface.TAG_DATETIME_ORIGINAL,new SimpleDateFormat("yyyy:MM:dd HH:mm:ss",Locale.US).format(new Date(at)));exif.setAttribute(ExifInterface.TAG_USER_COMMENT,asciiJson(embedded.toString()));exif.saveAttributes();
        JSONObject check=new JSONObject(new ExifInterface(file.getAbsolutePath()).getAttribute(ExifInterface.TAG_USER_COMMENT));if(!check.getString("capture_id").equals(session.getString("id")))throw new IOException("Metadata verification failed");
        final String path=file.getAbsolutePath();runOnUiThread(()->{setResult(RESULT_OK,new Intent().putExtra("path",path).putExtra("metadata",metadata.toString()));finish();});
    }catch(Exception e){if(file!=null)file.delete();runOnUiThread(()->{taking=false;status.setText("Could not prepare the photo. Close the camera and retry; no evidence was uploaded.");});}}
    private static String asciiJson(String json){StringBuilder out=new StringBuilder();for(int i=0;i<json.length();i++){char c=json.charAt(i);if(c>127)out.append(String.format(Locale.US,"\\u%04x",(int)c));else out.append(c);}return out.toString();}
    private static String gps(double value){double a=Math.abs(value);int degrees=(int)a;double minutes=(a-degrees)*60;int whole=(int)minutes;long seconds=Math.round((minutes-whole)*60*1000000);return degrees+"/1,"+whole+"/1,"+seconds+"/1000000";}
    private void close(){if(camera!=null){try{camera.stopPreview();camera.release();}catch(Exception ignored){}camera=null;}}
    @Override public void onPause(){handler.removeCallbacks(freshness);if(locations!=null)locations.removeUpdates(this);close();super.onPause();}
    @Override public void onLocationChanged(Location location){fix=location;updateStatus();}
    @Override public void onProviderDisabled(String provider){fix=null;updateStatus();}
    @Override public void onProviderEnabled(String provider){}
    @Override public void onStatusChanged(String provider,int status,Bundle extras){}
    @Override public void surfaceCreated(SurfaceHolder h){open();}
    @Override public void surfaceChanged(SurfaceHolder h,int f,int w,int height){}
    @Override public void surfaceDestroyed(SurfaceHolder h){close();}
    @Override public void onRequestPermissionsResult(int code,String[] p,int[] g){super.onRequestPermissionsResult(code,p,g);if(permitted()){startLocation();open();}else status.setText("Camera and precise location are required. Enable them in Android settings, then reopen this screen.");}
}
