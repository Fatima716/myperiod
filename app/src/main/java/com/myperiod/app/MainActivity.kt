package com.myperiod.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.OAuthProvider
import com.google.firebase.firestore.FirebaseFirestore
import org.json.JSONObject

class MainActivity : Activity() {

    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.statusBarColor = Color.parseColor("#FBF5F2")
        window.navigationBarColor = Color.parseColor("#FFFFFF")
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR

        Reminders.ensureChannel(this)

        web = WebView(this)
        setContentView(web)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = false
        }
        web.setBackgroundColor(Color.parseColor("#FBF5F2"))
        web.addJavascriptInterface(Bridge(), "Android")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (uri.scheme == "file") return false
                startActivity(Intent(Intent.ACTION_VIEW, uri))
                return true
            }
        }
        web.loadUrl("file:///android_asset/index.html")
    }

    private fun js(code: String) {
        runOnUiThread { web.evaluateJavascript(code, null) }
    }

    private fun firebaseReady(): Boolean = try {
        FirebaseApp.getApps(this).isNotEmpty()
    } catch (e: Exception) {
        false
    }

    private fun email(): String = try {
        if (firebaseReady()) FirebaseAuth.getInstance().currentUser?.email ?: "" else ""
    } catch (e: Exception) {
        ""
    }

    inner class Bridge {

        @JavascriptInterface
        fun share(text: String) {
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, text)
            }
            startActivity(Intent.createChooser(send, null))
        }

        /** json: [{id, at, title, text}] */
        @JavascriptInterface
        fun schedule(json: String) {
            if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                runOnUiThread { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1) }
            }
            Reminders.apply(this@MainActivity, json)
        }

        @JavascriptInterface
        fun hasFirebase(): Boolean = firebaseReady()

        @JavascriptInterface
        fun user(): String = email()

        @JavascriptInterface
        fun signIn() {
            if (!firebaseReady()) {
                js("onAuthError('Firebase غير مُعدّ')")
                return
            }
            runOnUiThread {
                val provider = OAuthProvider.newBuilder("google.com")
                    .addCustomParameter("prompt", "select_account")
                    .build()
                FirebaseAuth.getInstance()
                    .startActivityForSignInWithProvider(this@MainActivity, provider)
                    .addOnSuccessListener { r ->
                        js("onAuth(" + JSONObject.quote(r.user?.email ?: "") + ")")
                        pull()
                    }
                    .addOnFailureListener { e ->
                        js("onAuthError(" + JSONObject.quote(e.message ?: "فشل تسجيل الدخول") + ")")
                    }
            }
        }

        @JavascriptInterface
        fun signOut() {
            if (firebaseReady()) FirebaseAuth.getInstance().signOut()
        }

        /** رفع النسخة المحلية إلى السحابة */
        @JavascriptInterface
        fun syncUp(json: String, ts: Long) {
            val uid = if (firebaseReady()) FirebaseAuth.getInstance().currentUser?.uid else null
            if (uid == null) return
            FirebaseFirestore.getInstance().collection("users").document(uid)
                .set(mapOf("data" to json, "updatedAt" to ts))
        }

        /** جلب النسخة السحابية وتمريرها إلى الصفحة للدمج */
        @JavascriptInterface
        fun syncDown() {
            pull()
        }
    }

    private fun pull() {
        val uid = if (firebaseReady()) FirebaseAuth.getInstance().currentUser?.uid else null
        if (uid == null) return
        FirebaseFirestore.getInstance().collection("users").document(uid).get()
            .addOnSuccessListener { doc ->
                val data = doc.getString("data") ?: ""
                val ts = doc.getLong("updatedAt") ?: 0L
                js("onCloud(" + JSONObject.quote(data) + "," + ts + ")")
            }
            .addOnFailureListener { e ->
                js("onAuthError(" + JSONObject.quote(e.message ?: "تعذّر جلب البيانات") + ")")
            }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        web.evaluateJavascript("window.goBack ? window.goBack() : false") { result ->
            if (result != "true") {
                @Suppress("DEPRECATION")
                super.onBackPressed()
            }
        }
    }
}
