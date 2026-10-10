package com.repaido.agent;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.animation.AnimationUtils;
import android.webkit.*;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class AgentActivity extends Activity {
    @Override protected void onResume() {
        super.onResume();
        PushService.appVisible = true;
        PushService.dismissRequestNotifications(this);
    }

    @Override protected void onPause() {
        PushService.appVisible = false;
        super.onPause();
    }

    private WebView web;
    private GeolocationPermissions.Callback locationCallback;
    private String locationOrigin;
    private PermissionRequest selfiePermission;
    private androidx.webkit.JavaScriptReplyProxy cameraReply;
    private String cameraRequestId;
    private androidx.webkit.JavaScriptReplyProxy reportReply;
    private String reportRequestId;
    private byte[] reportBytes;
    private View splashContainer;
    private static final String AGENT_PORTAL_URL = BuildConfig.WEB_URL + "/worker";
    private static final long SPLASH_DELAY_MS = 150L;
    private ValueCallback<Uri[]> uploadCallback;

    private View buildSplashScreen() {
        FrameLayout root = new FrameLayout(this);
        root.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        root.setBackgroundColor(Color.parseColor("#F4F6FA"));

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER);
        card.setPadding(32, 32, 32, 32);
        FrameLayout.LayoutParams cardParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        );
        card.setLayoutParams(cardParams);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.repaido_logo);
        logo.setAdjustViewBounds(true);
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(220, 220);
        logo.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        logo.setLayoutParams(logoParams);

        View pulsingDot = new View(this);
        GradientDrawable dotBg = new GradientDrawable();
        dotBg.setShape(GradientDrawable.OVAL);
        dotBg.setColor(Color.parseColor("#17285C"));
        dotBg.setStroke(12, Color.parseColor("#DCE1E8"));
        pulsingDot.setBackground(dotBg);
        LinearLayout.LayoutParams dotParams = new LinearLayout.LayoutParams(24, 24);
        dotParams.topMargin = 16;
        pulsingDot.setLayoutParams(dotParams);
        pulsingDot.startAnimation(AnimationUtils.loadAnimation(this, android.R.anim.fade_in));

        TextView info = new TextView(this);
        info.setText("Opening your workspace…");
        info.setTextColor(Color.parseColor("#1E293B"));
        info.setTextSize(13f);
        info.setGravity(Gravity.CENTER);
        info.setPadding(0, 18, 0, 0);

        card.addView(logo);
        card.addView(pulsingDot);
        card.addView(info);
        root.addView(card);
        return root;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        );

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            );
        }

        FrameLayout root = new FrameLayout(this);
        root.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F4F6FA"));
        web.setVisibility(View.GONE);
        FrameLayout.LayoutParams webParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
        web.setLayoutParams(webParams);
        root.addView(web);

        splashContainer = buildSplashScreen();
        root.addView(splashContainer);
        setContentView(root);

        java.io.File[] abandoned=getCacheDir().listFiles((dir,name)->name.startsWith("repaido-evidence-"));
        if(abandoned!=null)for(java.io.File file:abandoned)file.delete();
        PushService.channels(this);
        setupNativeBridge();
        requestRequiredPermissions();

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setGeolocationEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(true);

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!origin.equals(BuildConfig.WEB_URL) && !origin.equals(BuildConfig.WEB_URL + "/")) { callback.invoke(origin, false, false); return; }
                if (ContextCompat.checkSelfPermission(AgentActivity.this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                    ContextCompat.checkSelfPermission(AgentActivity.this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, true);
                } else {
                    if (locationCallback != null) locationCallback.invoke(locationOrigin, false, false);
                    locationCallback = callback;
                    locationOrigin = origin;
                    ActivityCompat.requestPermissions(AgentActivity.this, new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 1002);
                }
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (!request.getOrigin().toString().replaceAll("/$", "").equals(BuildConfig.WEB_URL) || request.getResources().length != 1 || !PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(request.getResources()[0])) { request.deny(); return; }
                if (ContextCompat.checkSelfPermission(AgentActivity.this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                else { if (selfiePermission != null) selfiePermission.deny(); selfiePermission=request; ActivityCompat.requestPermissions(AgentActivity.this,new String[]{Manifest.permission.CAMERA},1003); }
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                uploadCallback = filePathCallback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.setType("image/*");
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                Intent chooser = Intent.createChooser(intent, "Choose image");
                startActivityForResult(chooser, 1003);
                return true;
            }
        });

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if ("https".equals(uri.getScheme()) && host != null && (host.equals(Uri.parse(BuildConfig.WEB_URL).getHost()) || host.equals("repaido.firebaseapp.com"))) {
                    return false;
                }
                if (uri.getScheme() != null && (uri.getScheme().equals("tel") || uri.getScheme().equals("mailto"))) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Exception ignored) {}
                    return true;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(AgentActivity.this, "Cannot open link", Toast.LENGTH_SHORT).show();
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (splashContainer != null && splashContainer.getVisibility() == View.VISIBLE) {
                    new Handler(Looper.getMainLooper()).postDelayed(() -> {
                        splashContainer.setVisibility(View.GONE);
                        web.setVisibility(View.VISIBLE);
                    }, SPLASH_DELAY_MS);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
            }
        });

        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (!isFinishing()) {
                web.loadUrl(AGENT_PORTAL_URL + destinationQuery(getIntent()));
            }
        }, 100);
    }

    private void setupNativeBridge() {
        if (!androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        androidx.webkit.WebViewCompat.addWebMessageListener(web, "RepaidoNative", java.util.Collections.singleton(BuildConfig.WEB_URL), (view, message, origin, mainFrame, reply) -> {
            if (!mainFrame || !origin.toString().equals(BuildConfig.WEB_URL)) return;
            String id = "";
            try {
                org.json.JSONObject data = new org.json.JSONObject(message.getData());
                id = data.getString("id");
                String action = data.getString("action");
                final String requestId = id;
                if (action.equals("captureEvidence")) {
                    if(cameraReply!=null){nativeReply(reply,id,null,"A camera capture is already open.");return;}
                    org.json.JSONObject session=data.getJSONObject("session");
                    for(String key:new String[]{"id","job_id","visit_id"})if(!session.getString(key).matches("[A-Za-z0-9_-]{1,100}"))throw new IllegalArgumentException();
                    cameraReply=reply;cameraRequestId=id;
                    startActivityForResult(new Intent(this,EvidenceCameraActivity.class).putExtra("session",session.toString()),2004);
                } else if (action.equals("saveReport")) {
                    if(reportReply!=null){nativeReply(reply,id,null,"Finish the open report save first.");return;}
                    String filename=data.getString("filename");
                    if(!filename.matches("Repaido-task-[A-Za-z0-9-]{1,50}\\.pdf"))throw new IllegalArgumentException();
                    String encoded=data.getString("data");
                    if(encoded.length()>7*1024*1024)throw new IllegalArgumentException();
                    byte[] bytes=android.util.Base64.decode(encoded,android.util.Base64.DEFAULT);
                    if(bytes.length<5||bytes.length>5*1024*1024||!new String(bytes,0,5,java.nio.charset.StandardCharsets.US_ASCII).equals("%PDF-"))throw new IllegalArgumentException();
                    reportReply=reply;reportRequestId=id;reportBytes=bytes;
                    Intent save=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/pdf").putExtra(Intent.EXTRA_TITLE,filename);
                    startActivityForResult(save,2005);
                } else if (action.equals("pushToken")) {
                    if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                        ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1001);
                        nativeReply(reply, id, null, "Allow notifications, then tap Enable again."); return;
                    }
                    com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                        nativeReply(reply, requestId, task.isSuccessful() ? task.getResult() : null, task.isSuccessful() ? null : "Push registration failed. Retry when connected.");
                    });
                } else if (action.equals("startTracking")) {
                    if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                        ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 1002);
                        nativeReply(reply, id, null, "Allow precise location, then tap Share again."); return;
                    }
                    String token = data.getString("token");
                    if (!token.matches("[A-Za-z0-9_-]{40,100}")) throw new IllegalArgumentException();
                    Intent service = new Intent(this, TrackingService.class).putExtra("token", token);
                    ContextCompat.startForegroundService(this, service);
                    nativeReply(reply, id, "started", null);
                } else if (action.equals("stopTracking")) {
                    startService(new Intent(this, TrackingService.class).setAction("STOP"));
                    nativeReply(reply, id, "stopped", null);
                } else nativeReply(reply, id, null, "Unsupported native action.");
            } catch (Exception ex) { nativeReply(reply, id, null, "Device action failed. Retry from the app."); }
        });
    }

    private void nativeReply(androidx.webkit.JavaScriptReplyProxy reply, String id, String result, String error) {
        try {
            org.json.JSONObject data = new org.json.JSONObject().put("id", id);
            if (result != null) data.put("result", result);
            if (error != null) data.put("error", error);
            reply.postMessage(data.toString());
        } catch (Exception ignored) { }
    }

    private String destinationQuery(Intent intent) {
        String destination=intent.getStringExtra("destination");
        String plan=intent.getStringExtra("plan_id");
        String ride=intent.getStringExtra("business_id"),role=intent.getStringExtra("business_role");
        if("mobility".equals(destination)&&ride!=null&&ride.matches("[a-f0-9]{64}")&&("cab_owner".equals(role)||"driver".equals(role)))return "?mode="+role+"&shared-ride="+android.net.Uri.encode(ride);
        if("home_plan".equals(destination)&&plan!=null&&plan.matches("[A-Za-z0-9_-]{1,100}"))return "?home-plan="+android.net.Uri.encode(plan);
        return "wallet".equals(destination)?"?tab=wallet":"hire".equals(destination)?"?tab=hire":"";
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);setIntent(intent);
        if(web!=null)web.loadUrl(AGENT_PORTAL_URL+destinationQuery(intent));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if(requestCode==2005&&reportReply!=null){
            try{
                if(resultCode!=RESULT_OK||data==null||data.getData()==null)nativeReply(reportReply,reportRequestId,null,"Save cancelled. Download the report again when ready.");
                else {
                    try(java.io.OutputStream out=getContentResolver().openOutputStream(data.getData())){if(out==null)throw new java.io.IOException();out.write(reportBytes);}
                    nativeReply(reportReply,reportRequestId,"saved",null);
                }
            }catch(Exception e){nativeReply(reportReply,reportRequestId,null,"Report could not be saved. Retry or choose another folder.");}
            finally{reportReply=null;reportRequestId=null;reportBytes=null;}
        }
        if (requestCode == 2004 && cameraReply != null) {
            try {
                if(resultCode!=RESULT_OK||data==null)nativeReply(cameraReply,cameraRequestId,null,"Capture cancelled. No photo was uploaded.");
                else {
                    java.io.File file=new java.io.File(data.getStringExtra("path"));
                    if(!file.getCanonicalPath().startsWith(getCacheDir().getCanonicalPath()+"/")||file.length()>5*1024*1024)throw new IllegalArgumentException();
                    byte[] bytes=java.nio.file.Files.readAllBytes(file.toPath());file.delete();
                    org.json.JSONObject result=new org.json.JSONObject().put("jpeg",android.util.Base64.encodeToString(bytes,android.util.Base64.NO_WRAP)).put("metadata",new org.json.JSONObject(data.getStringExtra("metadata")));
                    nativeReply(cameraReply,cameraRequestId,result.toString(),null);
                }
            }catch(Exception ex){nativeReply(cameraReply,cameraRequestId,null,"Photo could not be returned. Please retake it.");}
            finally{cameraReply=null;cameraRequestId=null;}
        }
        if (requestCode == 1003 && uploadCallback != null) {
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            uploadCallback.onReceiveValue(result);
            uploadCallback = null;
        }
    }

    private void requestRequiredPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1001);
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.ACCESS_FINE_LOCATION}, 1002);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 1003 && selfiePermission != null) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) selfiePermission.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE}); else selfiePermission.deny();
            selfiePermission=null;
        }
        if (requestCode == 1002 && locationCallback != null) {
            boolean allowed = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            locationCallback.invoke(locationOrigin, allowed, false);
            locationCallback = null;
            locationOrigin = null;
        }
        if (requestCode == 1001 && grantResults.length > 0 && grantResults[0] != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "Notifications permission is off; updates may be missed.", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
        }
        super.onDestroy();
    }
}
