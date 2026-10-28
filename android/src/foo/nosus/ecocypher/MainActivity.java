package foo.nosus.ecocypher;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * EcoCypher ESG — Android shell.
 * Serves the built web app from APK assets at https://appassets.ecocypher.local/
 * (a secure origin, so ES modules, localStorage, crypto.subtle and the camera all work),
 * and bridges file saving, printing, file picking and camera permission to Android.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.ecocypher.local";
    private static final String ORIGIN = "https://" + HOST + "/";
    private static final int REQ_FILE_CHOOSER = 101;
    private static final int REQ_SAVE_FILE = 102;
    private static final int REQ_CAMERA = 103;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermission;
    private byte[] pendingSaveBytes;

    private static final Map<String, String> MIME = new HashMap<String, String>();
    static {
        MIME.put("html", "text/html"); MIME.put("js", "text/javascript"); MIME.put("mjs", "text/javascript");
        MIME.put("css", "text/css"); MIME.put("json", "application/json"); MIME.put("webmanifest", "application/manifest+json");
        MIME.put("svg", "image/svg+xml"); MIME.put("png", "image/png"); MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg"); MIME.put("webp", "image/webp"); MIME.put("ico", "image/x-icon");
        MIME.put("woff", "font/woff"); MIME.put("woff2", "font/woff2"); MIME.put("ttf", "font/ttf"); MIME.put("txt", "text/plain");
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        installCrashLogger();
        String lastCrash = getSharedPreferences("diag", MODE_PRIVATE).getString("crash", null);
        try {
            web = new WebView(this);
        } catch (Throwable t) {
            // WebView missing / being updated: show a message instead of crashing
            showMessage("Android System WebView is unavailable or updating.\n\nPlease update \"Android System WebView\" and \"Chrome\" from the Play Store, then reopen EcoCypher.\n\n" + t);
            return;
        }
        web.setBackgroundColor(Color.parseColor("#FAF6EA"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " EcoCypherAndroid/2.1");

        web.addJavascriptInterface(new Bridge(), "EcoNative");
        web.setWebViewClient(new LocalClient());
        web.setWebChromeClient(new Chrome());

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(ORIGIN + "index.html");
        if (lastCrash != null) {
            getSharedPreferences("diag", MODE_PRIVATE).edit().remove("crash").apply();
            toast("EcoCypher recovered from an error last time");
        }
    }

    private void installCrashLogger() {
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            public void uncaughtException(Thread th, Throwable e) {
                try {
                    java.io.StringWriter sw = new java.io.StringWriter();
                    e.printStackTrace(new java.io.PrintWriter(sw));
                    getSharedPreferences("diag", MODE_PRIVATE).edit().putString("crash", sw.toString()).commit();
                } catch (Throwable ignored) {}
                if (prev != null) prev.uncaughtException(th, e);
            }
        });
    }

    private void showMessage(String msg) {
        android.widget.TextView tv = new android.widget.TextView(this);
        tv.setText(msg);
        tv.setTextSize(16);
        tv.setPadding(48, 96, 48, 48);
        tv.setTextColor(Color.parseColor("#1B2B22"));
        tv.setBackgroundColor(Color.parseColor("#FAF6EA"));
        setContentView(tv);
    }

    @Override
    protected void onDestroy() {
        if (web != null) { web.stopLoading(); web.destroy(); web = null; }
        super.onDestroy();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) { web.goBack(); return true; }
        return super.onKeyDown(keyCode, event);
    }

    // ---------- Serve bundled web app ----------
    private class LocalClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            String path = u.getPath();
            if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
            if (path.equals("/sw.js")) return notFound(); // no service worker inside the app shell
            String asset = "www" + path;
            try {
                InputStream in = getAssets().open(asset);
                String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase();
                String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
                WebResourceResponse r = new WebResourceResponse(mime, mime.startsWith("text") || mime.contains("json") || mime.contains("javascript") ? "utf-8" : null, in);
                Map<String, String> h = new HashMap<String, String>();
                h.put("Cache-Control", "no-cache");
                h.put("Access-Control-Allow-Origin", "*");
                r.setResponseHeaders(h);
                return r;
            } catch (Exception e) {
                // SPA fallback: unknown paths get index.html (app uses hash routing)
                if (!path.contains(".")) {
                    try { return new WebResourceResponse("text/html", "utf-8", getAssets().open("www/index.html")); } catch (Exception ignored) {}
                }
                return notFound();
            }
        }

        private WebResourceResponse notFound() {
            WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8", new java.io.ByteArrayInputStream(new byte[0]));
            r.setStatusCodeAndReasonPhrase(404, "Not Found");
            return r;
        }

        // API 24+ variant (minSdk is 24). No @Override: the API-23 compile jar lacks it, but it overrides at runtime.
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            return handleUrl(req.getUrl());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleUrl(Uri.parse(url));
        }

        private boolean handleUrl(Uri u) {
            String scheme = u.getScheme() == null ? "" : u.getScheme();
            if (HOST.equals(u.getHost()) || scheme.equals("blob") || scheme.equals("data")) return false;
            // Supabase auth redirects etc. stay in the app; everything else opens externally
            if (u.getHost() != null && u.getHost().endsWith("supabase.co")) return false;
            try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
            return true;
        }
    }

    // ---------- Camera + file picker ----------
    private class Chrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            runOnUiThread(new Runnable() { public void run() {
                boolean wantsCamera = false;
                for (String r : request.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsCamera = true;
                if (!wantsCamera) { request.deny(); return; }
                try {
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                } else {
                    pendingPermission = request;
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
                }
                } catch (Exception e) { try { request.deny(); } catch (Exception ignored) {} }
            }});
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                Intent i = params.createIntent();
                i.addCategory(Intent.CATEGORY_OPENABLE);
                String[] types = params.getAcceptTypes();
                boolean any = types == null || types.length == 0 || (types.length == 1 && types[0].isEmpty());
                if (any || hasExtensionOnly(types)) i.setType("*/*");
                startActivityForResult(Intent.createChooser(i, "Choose file"), REQ_FILE_CHOOSER);
            } catch (Exception e) {
                fileCallback = null;
                toast("No file picker available");
                return false;
            }
            return true;
        }

        private boolean hasExtensionOnly(String[] types) {
            for (String t : types) if (t.startsWith(".")) return true;
            return false;
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode == REQ_CAMERA && pendingPermission != null) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED)
                pendingPermission.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else pendingPermission.deny();
            pendingPermission = null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
        } else if (requestCode == REQ_SAVE_FILE) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingSaveBytes != null) {
                try {
                    OutputStream os = getContentResolver().openOutputStream(data.getData());
                    if (os == null) throw new java.io.IOException("no stream");
                    os.write(pendingSaveBytes);
                    os.close();
                    toast("Saved");
                } catch (Exception e) { toast("Could not save file"); }
            }
            pendingSaveBytes = null;
        } else super.onActivityResult(requestCode, resultCode, data);
    }

    // ---------- JS bridge (downloads + print) ----------
    private class Bridge {
        @JavascriptInterface
        public void saveFile(final String name, final String mime, final String base64) {
            runOnUiThread(new Runnable() { public void run() {
                try {
                    pendingSaveBytes = Base64.decode(base64, Base64.DEFAULT);
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType(mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                    i.putExtra(Intent.EXTRA_TITLE, name);
                    startActivityForResult(i, REQ_SAVE_FILE);
                } catch (Exception e) { toast("Could not save file"); }
            }});
        }

        @JavascriptInterface
        public void print(final String title) {
            runOnUiThread(new Runnable() { public void run() {
                if (web == null) return;
                PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                String jobName = (title == null || title.isEmpty()) ? "EcoCypher report" : title;
                PrintDocumentAdapter adapter = web.createPrintDocumentAdapter(jobName);
                try { pm.print(jobName, adapter, new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build()); }
                catch (Exception e) { toast("Printing is not available on this device"); }
            }});
        }
    }

    private void toast(String msg) { Toast.makeText(this, msg, Toast.LENGTH_SHORT).show(); }
}
