package cn.dlz.samplingphoto;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.content.Context;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileInputStream;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {

    /** 与 WebViewAssetLoader 的默认域名一致，网页因此获得 https 安全上下文 */
    public static final String HOST = "appassets.androidplatform.net";
    public static final String START_URL = "https://" + HOST + "/assets/public/index.html";

    private static final String TAG = "SamplingPhoto";
    private static final int REQ_FILES = 1001;
    private static final int REQ_PERMS = 1002;

    private WebView webView;
    private WebBridge bridge;
    private WebView printView;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#F4F1EA"));
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " SamplingPhotoApp/" + BuildConfig.VERSION_NAME);

        bridge = new WebBridge(this, webView);
        webView.addJavascriptInterface(bridge, "NativeBridge");

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new AssetHandler(this))
                .addPathHandler("/capture/", new CaptureHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u == null) return false;
                if (HOST.equals(u.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) { }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    Intent i = params.createIntent();
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    }
                    startActivityForResult(Intent.createChooser(i, "选择文件"), REQ_FILES);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean missing = false;
                    for (String res : request.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)
                                && !hasPermission(Manifest.permission.CAMERA)) {
                            missing = true;
                        }
                    }
                    if (missing) request.deny();
                    else request.grant(request.getResources());
                });
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin,
                                                           GeolocationPermissions.Callback callback) {
                boolean ok = hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                        || hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION);
                callback.invoke(origin, ok, false);
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, m.message() + " @ " + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });

        webView.loadUrl(START_URL);
        askPermissions();
    }

    /* ---------------- 权限 ---------------- */

    public boolean hasPermission(String perm) {
        return checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED;
    }

    public void askPermissions() {
        List<String> need = new ArrayList<>();
        if (!hasPermission(Manifest.permission.CAMERA)) {
            need.add(Manifest.permission.CAMERA);
        }
        if (!hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) {
            need.add(Manifest.permission.ACCESS_FINE_LOCATION);
            if (!hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)) {
                need.add(Manifest.permission.ACCESS_COARSE_LOCATION);
            }
        }
        if (Build.VERSION.SDK_INT <= 28
                && !hasPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)) {
            need.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        }
        if (!need.isEmpty()) {
            requestPermissions(need.toArray(new String[0]), REQ_PERMS);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQ_PERMS) {
            webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('native-permissions'))", null);
        }
    }

    /* ---------------- 结果回调 ---------------- */

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQ_FILES) {
            if (fileCallback == null) return;
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null) {
                    result = new Uri[clip.getItemCount()];
                    for (int i = 0; i < clip.getItemCount(); i++) {
                        result[i] = clip.getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    result = new Uri[]{ data.getData() };
                }
            }
            fileCallback.onReceiveValue(result);
            fileCallback = null;
            return;
        }

        if (bridge != null) bridge.onActivityResult(requestCode, resultCode, data);
    }

    /* ---------------- 打印 ---------------- */

    public void printHtmlFile(final String cbId, String path, final String jobName) {
        try {
            final WebView pv = new WebView(this);
            WebSettings ps = pv.getSettings();
            ps.setJavaScriptEnabled(false);
            ps.setAllowFileAccess(true);
            ps.setAllowContentAccess(true);
            pv.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    try {
                        PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                        if (pm == null) throw new IllegalStateException("系统打印服务不可用");
                        PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(jobName);
                        pm.print(jobName, adapter, new PrintAttributes.Builder().build());
                        bridge.resolveOk(cbId);
                    } catch (Throwable t) {
                        bridge.resolveFail(cbId, "print", String.valueOf(t.getMessage()));
                    }
                }
            });
            printView = pv;
            pv.loadUrl("file://" + path);
        } catch (Throwable t) {
            bridge.resolveFail(cbId, "print", String.valueOf(t.getMessage()));
        }
    }

    /* ---------------- 生命周期 ---------------- */

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (printView != null) {
            printView.destroy();
            printView = null;
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /** 从 assets/public 读网页文件，显式指定 MIME（ES module 对 MIME 很敏感） */
    static class AssetHandler implements WebViewAssetLoader.PathHandler {
        private final Context ctx;

        AssetHandler(Context ctx) {
            this.ctx = ctx;
        }

        @Override
        public WebResourceResponse handle(String path) {
            String clean = path == null ? "" : path;
            while (clean.startsWith("/")) clean = clean.substring(1);
            if (clean.isEmpty()) clean = "public/index.html";
            if (clean.contains("..")) return notFound();

            try {
                java.io.InputStream is = ctx.getAssets().open(clean);
                WebResourceResponse r = new WebResourceResponse(mimeOf(clean), "utf-8", is);
                java.util.Map<String, String> headers = new java.util.HashMap<>();
                headers.put("Cache-Control", "no-cache");
                r.setResponseHeaders(headers);
                return r;
            } catch (java.io.IOException e) {
                return notFound();
            }
        }

        private WebResourceResponse notFound() {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    new java.util.HashMap<String, String>(),
                    new java.io.ByteArrayInputStream("not found".getBytes()));
        }

        static String mimeOf(String p) {
            String s = p.toLowerCase();
            if (s.endsWith(".js") || s.endsWith(".mjs")) return "text/javascript";
            if (s.endsWith(".css")) return "text/css";
            if (s.endsWith(".html")) return "text/html";
            if (s.endsWith(".json") || s.endsWith(".webmanifest")) return "application/json";
            if (s.endsWith(".png")) return "image/png";
            if (s.endsWith(".jpg") || s.endsWith(".jpeg")) return "image/jpeg";
            if (s.endsWith(".svg")) return "image/svg+xml";
            if (s.endsWith(".ico")) return "image/x-icon";
            if (s.endsWith(".woff2")) return "font/woff2";
            if (s.endsWith(".txt")) return "text/plain";
            return "application/octet-stream";
        }
    }

    /** 把 cache/capture 下的照片以 https://HOST/capture/xxx.jpg 暴露给网页 fetch */
    static class CaptureHandler implements WebViewAssetLoader.PathHandler {
        private final Context ctx;

        CaptureHandler(Context ctx) {
            this.ctx = ctx;
        }

        @Override
        public WebResourceResponse handle(String path) {
            String name = path == null ? "" : path;
            while (name.startsWith("/")) name = name.substring(1);
            if (name.isEmpty() || name.contains("..") || name.contains("/") || name.contains("\\")) {
                return notFound();
            }
            File f = new File(new File(ctx.getCacheDir(), "capture"), name);
            if (!f.isFile()) return notFound();
            try {
                FileInputStream in = new FileInputStream(f);
                WebResourceResponse r = new WebResourceResponse("image/jpeg", null, in);
                java.util.Map<String, String> headers = new java.util.HashMap<>();
                headers.put("Cache-Control", "no-store");
                headers.put("Content-Length", String.valueOf(f.length()));
                r.setResponseHeaders(headers);
                return r;
            } catch (java.io.IOException e) {
                return notFound();
            }
        }

        private WebResourceResponse notFound() {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    new java.util.HashMap<String, String>(),
                    new java.io.ByteArrayInputStream("not found".getBytes()));
        }
    }
}
