package com.repaido.go;

import android.Manifest;
import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.*;
import com.google.firebase.messaging.FirebaseMessaging;
import com.repaido.ride.RideNotifications;
import org.json.JSONObject;
import java.util.Collections;

/** A dedicated Go launcher; the authenticated website remains the source of ride state. */
public final class GoActivity extends Activity {
    private WebView web;
    private LinearLayout problem;
    private GeolocationPermissions.Callback geo;
    private String geoOrigin;
    private JavaScriptReplyProxy permissionReply;
    private String permissionId;
    private ValueCallback<Uri[]> upload;
    private String lastUrl=BuildConfig.WEB_URL+BuildConfig.START_PATH;
    private boolean pageFailed;

    private boolean trusted(Uri uri) {
        Uri expected=Uri.parse(BuildConfig.WEB_URL);
        return uri!=null && "https".equals(uri.getScheme()) && expected.getHost().equals(uri.getHost()) && expected.getPort()==uri.getPort();
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        GoFirebase.ready(this);
        FrameLayout frame=new FrameLayout(this);frame.setBackgroundColor(Color.rgb(248,249,250));
        web=new WebView(this);web.setBackgroundColor(Color.rgb(248,249,250));
        frame.addView(web,new FrameLayout.LayoutParams(-1,-1));
        problem=new LinearLayout(this);problem.setOrientation(LinearLayout.VERTICAL);problem.setGravity(Gravity.CENTER);
        problem.setPadding(32,24,32,24);problem.setBackgroundColor(Color.rgb(248,249,250));
        TextView title=new TextView(this);title.setText(R.string.reconnect_title);title.setTextSize(22);title.setTextColor(Color.rgb(32,33,36));
        TextView body=new TextView(this);body.setText(R.string.reconnect_message);body.setGravity(Gravity.CENTER);body.setPadding(0,16,0,16);body.setTextColor(Color.rgb(95,99,104));
        Button retry=new Button(this);retry.setText(R.string.retry);retry.setOnClickListener(v->{problem.setVisibility(View.GONE);web.loadUrl(lastUrl);});
        problem.addView(title);problem.addView(body);problem.addView(retry);problem.setVisibility(View.GONE);frame.addView(problem,new FrameLayout.LayoutParams(-1,-1));setContentView(frame);
        ViewCompat.setOnApplyWindowInsetsListener(frame,(view,insets)->{androidx.core.graphics.Insets bars=insets.getInsets(WindowInsetsCompat.Type.systemBars());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);return insets;});
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUserAgentString(settings.getUserAgentString()+" RepaidoGo/"+BuildConfig.VERSION_NAME+" "+BuildConfig.APP_KIND);
        web.setWebChromeClient(new WebChromeClient(){
            @Override public void onGeolocationPermissionsShowPrompt(String origin,GeolocationPermissions.Callback callback){
                if(!trusted(Uri.parse(origin))){callback.invoke(origin,false,false);return;}
                if(ContextCompat.checkSelfPermission(GoActivity.this,Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED){callback.invoke(origin,true,false);return;}
                if(geo!=null)geo.invoke(geoOrigin,false,false);geo=callback;geoOrigin=origin;
                ActivityCompat.requestPermissions(GoActivity.this,new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},24);
            }
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(!trusted(Uri.parse(web.getUrl())))return false;
                if(upload!=null)upload.onReceiveValue(null);upload=callback;
                try{startActivityForResult(params.createIntent(),25);}catch(ActivityNotFoundException missing){upload.onReceiveValue(null);upload=null;}return true;
            }
        });
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();if(trusted(uri))return false;
                // Firebase/reCAPTCHA embeds need HTTPS navigation, but receive no native bridge.
                if(!request.isForMainFrame())return !"https".equals(uri.getScheme());
                if(java.util.Arrays.asList("https","tel","mailto","geo").contains(uri.getScheme()))openExternal(uri);
                return true;
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){pageFailed=false;if(trusted(Uri.parse(url)))lastUrl=url;}
            @Override public void onPageFinished(WebView view,String url){if(trusted(Uri.parse(url))&&!pageFailed){lastUrl=url;problem.setVisibility(View.GONE);resumeWeb();}}
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame()){pageFailed=true;problem.setVisibility(View.VISIBLE);}}
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){if(request.isForMainFrame()&&response.getStatusCode()>=400){pageFailed=true;problem.setVisibility(View.VISIBLE);}}
        });
        if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))WebViewCompat.addWebMessageListener(web,"RepaidoNative",Collections.singleton(BuildConfig.WEB_URL),(view,message,origin,mainFrame,reply)->{
            if(!mainFrame||!trusted(origin))return;
            String id="";
            try{
                JSONObject data=new JSONObject(message.getData());id=data.getString("id");String action=data.getString("action");
                if(action.equals("appKind"))respond(reply,id,BuildConfig.APP_KIND,null);
                else if(action.equals("ridePushVersion"))respond(reply,id,"1",null);
                else if(action.equals("pushStatus"))respond(reply,id,NotificationManagerCompat.from(this).areNotificationsEnabled()?"enabled":"disabled",null);
                else if(action.equals("bindPushAccount")){String uid=data.optString("uid","");if(!uid.isEmpty()&&!uid.matches("[A-Za-z0-9:_-]{1,128}"))throw new IllegalArgumentException();RideNotifications.bind(this,uid);respond(reply,id,"saved",null);}
                else if(action.equals("clearRideAlerts")){RideNotifications.clear(this);respond(reply,id,"cleared",null);}
                else if(action.equals("stopTracking")){respond(reply,id,"stopped",null);}
                else if(action.equals("openRepaido")){Intent app=getPackageManager().getLaunchIntentForPackage("com.repaido.app");if(app!=null)startActivity(app);else openExternal(Uri.parse(BuildConfig.WEB_URL));respond(reply,id,"opened",null);}
                else if(action.equals("pushSettings")){startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()));respond(reply,id,"opened",null);}
                else if(action.equals("pushToken")){
                    if(!GoFirebase.ready(this)){respond(reply,id,null,"Notifications are not configured in this app build.");return;}
                    if(Build.VERSION.SDK_INT>=33&&ContextCompat.checkSelfPermission(this,Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){
                        if(permissionReply!=null){respond(reply,id,null,"Finish the open notification prompt first.");return;}
                        permissionReply=reply;permissionId=id;ActivityCompat.requestPermissions(this,new String[]{Manifest.permission.POST_NOTIFICATIONS},23);
                    }else getToken(reply,id);
                }else respond(reply,id,null,"This device action is not available in Go.");
            }catch(Exception invalid){respond(reply,id,null,"Could not complete that device action.");}
        });
        if(state==null||web.restoreState(state)==null)openRide(getIntent());
    }
    private void getToken(JavaScriptReplyProxy reply,String id){
        if(!NotificationManagerCompat.from(this).areNotificationsEnabled()){respond(reply,id,null,"Notifications are off in Android settings. Enable them for this app, then retry.");return;}
        FirebaseMessaging.getInstance().setAutoInitEnabled(true);
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task->respond(reply,id,task.isSuccessful()?task.getResult():null,task.isSuccessful()?null:"Could not connect notifications. Retry when connected."));
    }
    private static void respond(JavaScriptReplyProxy reply,String id,String result,String error){try{if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))return;JSONObject data=new JSONObject().put("id",id);if(result!=null)data.put("result",result);if(error!=null)data.put("error",error);reply.postMessage(data.toString());}catch(Exception ignored){}}
    private void openExternal(Uri uri){try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(ActivityNotFoundException missing){Toast.makeText(this,"No app can open this link",Toast.LENGTH_SHORT).show();}}
    private void openRide(Intent intent){String path=RideNotifications.pathFromIntent(this,intent);web.loadUrl(BuildConfig.WEB_URL+(path==null?BuildConfig.START_PATH:path));}
    private void resumeWeb(){if(web!=null&&web.getUrl()!=null&&trusted(Uri.parse(web.getUrl())))web.evaluateJavascript("window.dispatchEvent(new Event('repaido:native-resume'))",null);}
    @Override protected void onResume(){super.onResume();if(web!=null){web.onResume();resumeWeb();}}
    @Override protected void onPause(){if(web!=null)web.onPause();super.onPause();}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);openRide(intent);}
    @Override protected void onSaveInstanceState(Bundle state){web.saveState(state);super.onSaveInstanceState(state);}
    @Override public void onBackPressed(){
        web.evaluateJavascript("(()=>{const list=document.querySelectorAll('dialog[open]');const top=list[list.length-1];if(!top)return false;top.dispatchEvent(new Event('cancel',{cancelable:true}));return true;})()",handled->{if(!"true".equals(handled)){if(web.canGoBack())web.goBack();else moveTaskToBack(true);}});
    }
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] grants){
        super.onRequestPermissionsResult(code,permissions,grants);
        if(code==23&&permissionReply!=null){JavaScriptReplyProxy reply=permissionReply;String id=permissionId;permissionReply=null;permissionId=null;if(grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED)getToken(reply,id);else respond(reply,id,null,"Notifications remain off. You can enable them in Android settings.");}
        if(code==24&&geo!=null){boolean allowed=ContextCompat.checkSelfPermission(this,Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED||ContextCompat.checkSelfPermission(this,Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;geo.invoke(geoOrigin,allowed,false);geo=null;geoOrigin=null;}
    }
    @Override protected void onActivityResult(int code,int result,Intent data){super.onActivityResult(code,result,data);if(code==25&&upload!=null){upload.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));upload=null;}}
    @Override protected void onDestroy(){if(upload!=null)upload.onReceiveValue(null);if(geo!=null)geo.invoke(geoOrigin,false,false);web.destroy();super.onDestroy();}
}
