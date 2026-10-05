package com.repaido.app

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.animation.AnimationUtils
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : Activity() {
    private var selfiePermission: PermissionRequest? = null
    private var locationCallback: GeolocationPermissions.Callback? = null
    private var locationOrigin: String? = null
    private lateinit var web: WebView
    private lateinit var splashContainer: View
    private val customerPortalUrl = BuildConfig.WEB_URL
    private var uploadCallback: ValueCallback<Array<Uri>>? = null
    private val splashDelayMs = 150L

    private fun requestRequiredPermissions() {
        val permissions = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.ACCESS_FINE_LOCATION)
        }

        if (permissions.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, permissions.toTypedArray(), 1001)
        }
    }

    private fun buildSplashScreen(): View {
        val root = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#F8FAFC"))
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
            )
            setPadding(32, 32, 32, 32)
        }

        val logo = ImageView(this).apply {
            setImageResource(R.drawable.repaido_logo)
            adjustViewBounds = true
            layoutParams = LinearLayout.LayoutParams(220, 220)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
        }

        val pulsingDot = View(this).apply {
            val bg = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#FF6B35"))
                setStroke(12, Color.parseColor("#FFD7B8"))
            }
            background = bg
            layoutParams = LinearLayout.LayoutParams(24, 24)
            alpha = 0.9f
        }
        pulsingDot.startAnimation(AnimationUtils.loadAnimation(this, android.R.anim.fade_in))

        val pulseAnimation = AnimationUtils.loadAnimation(this, android.R.anim.fade_in)
        pulseAnimation.duration = 800
        pulsingDot.startAnimation(pulseAnimation)

        val info = TextView(this).apply {
            text = "Loading live service map..."
            setTextColor(Color.parseColor("#1E293B"))
            textSize = 13f
            gravity = Gravity.CENTER
            setPadding(0, 18, 0, 0)
        }

        card.addView(logo)
        card.addView(pulsingDot)
        card.addView(info)
        root.addView(card)
        return root
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.setFlags(
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            window.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        }

        val root = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#F8FAFC"))
        web.visibility = View.GONE
        web.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        root.addView(web)

        splashContainer = buildSplashScreen()
        root.addView(splashContainer)
        setContentView(root)

        CustomerPushService.channels(this)
        CustomerBridge.install(this, web)

        val settings: WebSettings = web.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mediaPlaybackRequiresUserGesture = false
        settings.setGeolocationEnabled(true)
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.allowFileAccess = false
        settings.allowContentAccess = true
        settings.setAllowFileAccessFromFileURLs(false)
        settings.setAllowContentAccess(true)
        settings.javaScriptCanOpenWindowsAutomatically = true
        settings.setSupportMultipleWindows(true)
        settings.loadsImagesAutomatically = true

        web.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String,
                callback: GeolocationPermissions.Callback
            ) {
                if (Uri.parse(origin).scheme != "https" || Uri.parse(origin).host != Uri.parse(customerPortalUrl).host) {
                    callback.invoke(origin, false, false); return
                }
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                    ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
                ) {
                    callback.invoke(origin, true, true)
                } else {
                    locationCallback?.invoke(locationOrigin, false, false)
                    locationCallback=callback
                    locationOrigin=origin
                    ActivityCompat.requestPermissions(
                        this@MainActivity,
                        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                        1002
                    )
                }
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                if (request.origin.toString().trimEnd('/') != BuildConfig.WEB_URL || request.resources.toList() != listOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) { request.deny(); return }
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                else { selfiePermission?.deny(); selfiePermission=request; ActivityCompat.requestPermissions(this@MainActivity,arrayOf(Manifest.permission.CAMERA),1003) }
            }

            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                uploadCallback = filePathCallback
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "image/*"
                    addCategory(Intent.CATEGORY_OPENABLE)
                }
                val chooser = Intent.createChooser(intent, "Choose image")
                startActivityForResult(chooser, 1003)
                return true
            }
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return false
                val host = uri.host.orEmpty()
                val mapsLink = host == "www.google.com" && uri.path?.startsWith("/maps") == true
                val isRepaidoHost = host == Uri.parse(BuildConfig.WEB_URL).host || host == "repaido.firebaseapp.com"
                if (uri.scheme == "https" && isRepaidoHost && !mapsLink) return false

                if (uri.scheme == "tel" || uri.scheme == "mailto") {
                    return try {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                        true
                    } catch (_: ActivityNotFoundException) {
                        Toast.makeText(this@MainActivity, "Cannot open link", Toast.LENGTH_SHORT).show()
                        true
                    }
                }

                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                    true
                } catch (_: ActivityNotFoundException) {
                    Toast.makeText(this@MainActivity, "Cannot open link", Toast.LENGTH_SHORT).show()
                    true
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (splashContainer.isShown) {
                    Handler(Looper.getMainLooper()).postDelayed({
                        splashContainer.visibility = View.GONE
                        web.visibility = View.VISIBLE
                    }, splashDelayMs)
                }
            }
        }

        Handler(Looper.getMainLooper()).postDelayed({
            if (!isFinishing) {
                openNotification(intent)
            }
        }, 100)
    }

    private fun openNotification(source: Intent) {
        val plan=source.getStringExtra("plan_id")
        val campaign=source.getStringExtra("campaign_id")
        val job=source.getStringExtra("job_id")
        val suffix=if(plan!=null && plan.matches(Regex("[A-Za-z0-9_-]{1,100}"))) "?home-plan="+Uri.encode(plan)
            else if(campaign!=null && campaign.matches(Regex("[A-Za-z0-9_-]{3,80}"))) "?campaign="+Uri.encode(campaign)
            else if(job!=null && job.matches(Regex("[A-Za-z0-9_-]{1,100}"))) "?booking="+Uri.encode(job) else ""
        web.loadUrl(customerPortalUrl+suffix)
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent);setIntent(intent)
        if(intent.hasExtra("job_id") || intent.hasExtra("campaign_id") || intent.hasExtra("plan_id")) openNotification(intent)
    }
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 1003 && uploadCallback != null) {
            val results = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            uploadCallback?.onReceiveValue(results)
            uploadCallback = null
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 1003) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) selfiePermission?.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else selfiePermission?.deny()
            selfiePermission=null
        }
        if (requestCode == 1002) {
            val allowed=ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED
            locationCallback?.invoke(locationOrigin,allowed,false);locationCallback=null;locationOrigin=null
        }
        if (requestCode == 1001 && grantResults.isNotEmpty()) {
            val anyGranted = grantResults.any { it == PackageManager.PERMISSION_GRANTED }
            if (!anyGranted) {
                Toast.makeText(this, "Some permissions were denied; some features may be limited.", Toast.LENGTH_SHORT).show()
            }
        }
    }

    @Deprecated("Use onBackPressed for compatibility")
    override fun onBackPressed() {
        if (web.canGoBack()) {
            web.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }
}
