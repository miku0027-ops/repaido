package com.repaido.app;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.google.firebase.messaging.FirebaseMessaging;
import org.json.JSONObject;
import java.util.Collections;

/** Exposed only to the trusted HTTPS main frame. Never exposes auth or bank data. */
public final class CustomerBridge {
    public static void install(Activity activity, WebView web) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(web, "RepaidoNative", Collections.singleton(BuildConfig.WEB_URL), (view,message,origin,mainFrame,reply)->{
            if (!mainFrame || !origin.toString().equals(BuildConfig.WEB_URL)) return;
            String id="";
            try {
                JSONObject data=new JSONObject(message.getData());id=data.getString("id");
                String action=data.getString("action");final String requestId=id;
                if (action.equals("appKind")) { respond(reply,id,"customer",null);
                } else if (action.equals("setOffersEnabled")) { activity.getSharedPreferences("repaido_offers",Activity.MODE_PRIVATE).edit().putBoolean("enabled",data.optBoolean("enabled",false)).apply();respond(reply,id,"saved",null);
                } else if (action.equals("pushToken")) {
                    if (Build.VERSION.SDK_INT>=33 && ContextCompat.checkSelfPermission(activity,Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) {
                        ActivityCompat.requestPermissions(activity,new String[]{Manifest.permission.POST_NOTIFICATIONS},1001);
                        respond(reply,id,null,"Allow notifications, then tap Enable again.");return;
                    }
                    FirebaseMessaging.getInstance().setAutoInitEnabled(true);
                    FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task->respond(reply,requestId,task.isSuccessful()?task.getResult():null,task.isSuccessful()?null:"Could not register notifications. Retry when connected."));
                } else if (action.equals("stopTracking")) { activity.getSharedPreferences("repaido_offers",Activity.MODE_PRIVATE).edit().putBoolean("enabled",false).apply();respond(reply,id,"stopped",null); }
                else respond(reply,id,null,"Use the Repaido Agent app for background task location sharing.");
            } catch (Exception error) { respond(reply,id,null,"Device action failed. Please retry."); }
        });
    }
    private static void respond(JavaScriptReplyProxy reply,String id,String value,String error) {
        try {JSONObject data=new JSONObject().put("id",id);if(value!=null)data.put("result",value);if(error!=null)data.put("error",error);reply.postMessage(data.toString());}catch(Exception ignored){}
    }
}
