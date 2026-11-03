package cn.dlz.samplingphoto;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.util.HashMap;
import java.util.Map;

/** 网页 ↔ 原生桥：拍照、定位、存相册、分享、打印 */
public class WebBridge {

    static final int REQ_CAMERA = 2001;

    private final MainActivity act;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, FileOutputStream> streams = new HashMap<>();

    private String cameraCbId;
    private File cameraFile;

    WebBridge(MainActivity act, WebView web) {
        this.act = act;
        this.web = web;
    }

    /* ---------------- 回调 ---------------- */

    void resolve(String id, boolean ok, String json) {
        if (id == null) return;
        final String js = "window.__nativeResolve(" + JSONObject.quote(id) + ","
                + ok + "," + (json == null ? "null" : json) + ");";
        web.post(() -> {
            try {
                web.evaluateJavascript(js, null);
            } catch (Throwable ignored) { }
        });
    }

    void resolveOk(String id) {
        resolve(id, true, "null");
    }

    void resolveFail(String id, String code, String message) {
        try {
            JSONObject o = new JSONObject();
            o.put("code", code == null ? "error" : code);
            o.put("message", message == null ? "操作失败" : message);
            resolve(id, false, o.toString());
        } catch (Exception e) {
            resolve(id, false, null);
        }
    }

    private static String msg(Throwable t) {
        String m = t.getMessage();
        return (m == null || m.isEmpty()) ? t.getClass().getSimpleName() : m;
    }

    /* ---------------- 基础 ---------------- */

    @JavascriptInterface
    public boolean isNative() {
        return true;
    }

    @JavascriptInterface
    public String info() {
        try {
            JSONObject o = new JSONObject();
            o.put("version", BuildConfig.VERSION_NAME);
            o.put("sdk", android.os.Build.VERSION.SDK_INT);
            o.put("model", android.os.Build.MODEL);
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    @JavascriptInterface
    public void toast(final String text) {
        act.runOnUiThread(() ->
                Toast.makeText(act, text == null ? "" : text, Toast.LENGTH_SHORT).show());
    }

    @JavascriptInterface
    public void vibrate(int ms) {
        try {
            Vibrator v = (Vibrator) act.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                v.vibrate(VibrationEffect.createOneShot(Math.max(1, ms),
                        VibrationEffect.DEFAULT_AMPLITUDE));
            }
        } catch (Throwable ignored) { }
    }

    /* ---------------- 拍照 ---------------- */

    @JavascriptInterface
    public void takePhoto(final String id) {
        act.runOnUiThread(() -> startCamera(id));
    }

    private void startCamera(String id) {
        if (!act.hasPermission(Manifest.permission.CAMERA)) {
            act.askPermissions();
            resolveFail(id, "denied", "相机权限未授予，请在系统设置里允许后重试");
            return;
        }
        try {
            File dir = new File(act.getCacheDir(), "capture");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("无法创建缓存目录");
            File f = new File(dir, "IMG_" + System.currentTimeMillis() + ".jpg");
            Uri uri = FileProvider.getUriForFile(act,
                    act.getPackageName() + ".fileprovider", f);

            Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            i.putExtra(MediaStore.EXTRA_OUTPUT, uri);
            i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (i.resolveActivity(act.getPackageManager()) == null) {
                resolveFail(id, "nocamera", "没有找到可用的相机应用");
                return;
            }
            cameraCbId = id;
            cameraFile = f;
            act.startActivityForResult(i, REQ_CAMERA);
        } catch (Throwable t) {
            resolveFail(id, "camera", "无法打开相机：" + msg(t));
        }
    }

    void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQ_CAMERA) return;

        final String id = cameraCbId;
        final File f = cameraFile;
        cameraCbId = null;
        cameraFile = null;
        if (id == null) return;

        if (resultCode != Activity.RESULT_OK || f == null || !f.exists() || f.length() == 0) {
            if (f != null) f.delete();
            resolve(id, true, "null");   // 用户取消
            return;
        }

        new Thread(() -> {
            try {
                String dataUrl = ImageUtil.toDataUrl(f, 2048, 92);
                f.delete();
                resolve(id, true, JSONObject.quote(dataUrl));
            } catch (Throwable t) {
                f.delete();
                resolveFail(id, "image", "读取照片失败：" + msg(t));
            }
        }).start();
    }

    /* ---------------- 定位 ---------------- */

    @JavascriptInterface
    public void locate(final String id, final String timeoutMs) {
        int timeout = 8000;
        try {
            timeout = Integer.parseInt(String.valueOf(timeoutMs));
        } catch (Throwable ignored) { }
        final int t = Math.max(2000, Math.min(timeout, 30000));
        act.runOnUiThread(() -> startLocate(id, t));
    }

    private void startLocate(String id, int timeout) {
        if (!act.hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                && !act.hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)) {
            act.askPermissions();
            resolveFail(id, "denied", "定位权限未授予");
            return;
        }
        LocationManager lm = (LocationManager) act.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) {
            resolveFail(id, "unavailable", "设备不支持定位");
            return;
        }

        Location seed = null;
        try {
            for (String p : lm.getProviders(true)) {
                Location l = lm.getLastKnownLocation(p);
                if (l != null && (seed == null || l.getTime() > seed.getTime())) seed = l;
            }
        } catch (Throwable ignored) { }

        LocateJob job = new LocateJob(id, lm, seed);
        if (seed != null && System.currentTimeMillis() - seed.getTime() < 60000) {
            job.finish();
            return;
        }
        try {
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 0, 0, job,
                        Looper.getMainLooper());
            }
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 0, 0, job,
                        Looper.getMainLooper());
            }
        } catch (SecurityException e) {
            resolveFail(id, "denied", "定位权限被拒绝");
            return;
        } catch (Throwable t) {
            resolveFail(id, "unavailable", "定位不可用：" + msg(t));
            return;
        }
        main.postDelayed(job::finish, timeout);
    }

    private class LocateJob implements LocationListener {
        private final String id;
        private final LocationManager lm;
        private Location best;
        private boolean done;

        LocateJob(String id, LocationManager lm, Location seed) {
            this.id = id;
            this.lm = lm;
            this.best = seed;
        }

        @Override
        public void onLocationChanged(Location l) {
            if (done || l == null) return;
            if (best == null || !best.hasAccuracy()
                    || (l.hasAccuracy() && l.getAccuracy() < best.getAccuracy())) {
                best = l;
            }
            if (best.hasAccuracy() && best.getAccuracy() <= 25) finish();
        }

        @Override
        public void onProviderEnabled(String provider) { }

        @Override
        public void onProviderDisabled(String provider) { }

        @Override
        public void onStatusChanged(String provider, int status, Bundle extras) { }

        void finish() {
            if (done) return;
            done = true;
            try {
                lm.removeUpdates(this);
            } catch (Throwable ignored) { }
            if (best == null) {
                resolveFail(id, "unavailable", "未能获取定位，请到空旷处或打开 GPS");
                return;
            }
            try {
                JSONObject o = new JSONObject();
                o.put("lat", best.getLatitude());
                o.put("lng", best.getLongitude());
                o.put("accuracy", best.hasAccuracy() ? best.getAccuracy() : 0.0);
                resolve(id, true, o.toString());
            } catch (Exception e) {
                resolveFail(id, "unavailable", "定位数据异常");
            }
        }
    }

    /* ---------------- 存相册 ---------------- */

    @JavascriptInterface
    public void saveImage(final String id, final String b64, final String subDir,
                          final String name) {
        new Thread(() -> {
            try {
                byte[] data = Base64.decode(b64, Base64.DEFAULT);
                String path = MediaSaver.save(act, data, subDir, name);
                JSONObject o = new JSONObject();
                o.put("path", path);
                resolve(id, true, o.toString());
            } catch (Throwable t) {
                resolveFail(id, "io", "存入相册失败：" + msg(t));
            }
        }).start();
    }

    /* ---------------- 临时文件 / 分享 / 打印 ---------------- */

    @JavascriptInterface
    public String beginFile(String name) {
        try {
            File dir = new File(act.getCacheDir(), "share");
            if (!dir.exists() && !dir.mkdirs()) return "null";
            File f = new File(dir, safeName(name));
            FileOutputStream fos = new FileOutputStream(f, false);
            streams.put(f.getAbsolutePath(), fos);
            return f.getAbsolutePath();
        } catch (Throwable t) {
            return "null";
        }
    }

    @JavascriptInterface
    public void appendChunk(String path, String b64) {
        FileOutputStream fos = streams.get(path);
        if (fos == null) return;
        try {
            fos.write(Base64.decode(b64, Base64.DEFAULT));
        } catch (Throwable ignored) { }
    }

    @JavascriptInterface
    public long closeFile(String path) {
        FileOutputStream fos = streams.remove(path);
        if (fos == null) return 0;
        try {
            fos.flush();
            fos.close();
        } catch (Throwable ignored) { }
        File f = new File(path);
        return f.exists() ? f.length() : 0;
    }

    @JavascriptInterface
    public void shareFile(final String id, final String path, final String mime,
                          final String title) {
        act.runOnUiThread(() -> {
            try {
                File f = new File(path);
                if (!f.exists() || f.length() == 0) {
                    resolveFail(id, "io", "文件不存在");
                    return;
                }
                Uri uri = FileProvider.getUriForFile(act,
                        act.getPackageName() + ".fileprovider", f);
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType(mime == null || mime.isEmpty() ? "*/*" : mime);
                i.putExtra(Intent.EXTRA_STREAM, uri);
                i.putExtra(Intent.EXTRA_SUBJECT, title == null ? "" : title);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                String t = (title == null || title.isEmpty()) ? "分享" : title;
                act.startActivity(Intent.createChooser(i, t));
                resolveOk(id);
            } catch (Throwable t) {
                resolveFail(id, "share", "分享失败：" + msg(t));
            }
        });
    }

    @JavascriptInterface
    public void printFile(final String id, final String path, final String jobName) {
        act.runOnUiThread(() -> {
            File f = new File(path);
            if (!f.exists()) {
                resolveFail(id, "io", "打印文件不存在");
                return;
            }
            act.printHtmlFile(id, path, jobName == null ? "照片汇总" : jobName);
        });
    }

    /* ---------------- 工具 ---------------- */

    static String safeName(String name) {
        String s = String.valueOf(name);
        s = s.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_");
        if (s.length() > 120) s = s.substring(0, 120);
        if (s.trim().isEmpty()) s = "file";
        return s;
    }

    @SuppressWarnings("unused")
    private boolean granted(String perm) {
        return act.checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED;
    }
}
