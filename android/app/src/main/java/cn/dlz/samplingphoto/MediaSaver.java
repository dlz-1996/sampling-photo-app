package cn.dlz.samplingphoto;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/** 把照片另存一份到系统相册：Pictures/抽样拍照/{批次号}/{类别}/ */
public class MediaSaver {

    public static final String ROOT = "抽样拍照";

    public static String save(Context ctx, byte[] data, String subDir, String name)
            throws IOException {
        String clean = cleanSubDir(subDir);
        String rel = Environment.DIRECTORY_PICTURES + "/" + ROOT
                + (clean.isEmpty() ? "" : "/" + clean);
        String fileName = WebBridge.safeName(name);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver cr = ctx.getContentResolver();
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
            cv.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            cv.put(MediaStore.Images.Media.RELATIVE_PATH, rel);
            cv.put(MediaStore.Images.Media.IS_PENDING, 1);

            Uri uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
            if (uri == null) throw new IOException("无法在相册中创建文件");
            try {
                OutputStream os = cr.openOutputStream(uri);
                if (os == null) throw new IOException("无法写入相册");
                os.write(data);
                os.flush();
                os.close();
                ContentValues done = new ContentValues();
                done.put(MediaStore.Images.Media.IS_PENDING, 0);
                cr.update(uri, done, null, null);
            } catch (IOException e) {
                try { cr.delete(uri, null, null); } catch (Throwable ignored) { }
                throw e;
            }
            return rel + "/" + fileName;
        }

        // Android 8 ~ 9：公共 Pictures 目录 + 扫描通知相册
        File dir = new File(Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_PICTURES), ROOT + (clean.isEmpty() ? "" : "/" + clean));
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("无法创建相册目录");
        File out = new File(dir, fileName);
        try (FileOutputStream fos = new FileOutputStream(out)) {
            fos.write(data);
            fos.flush();
        }
        try {
            MediaScannerConnection.scanFile(ctx, new String[]{ out.getAbsolutePath() },
                    null, null);
        } catch (Throwable ignored) { }
        return out.getAbsolutePath();
    }

    private static String cleanSubDir(String subDir) {
        if (subDir == null) return "";
        StringBuilder sb = new StringBuilder();
        String[] parts = subDir.split("[/\\\\]");
        for (String p : parts) {
            String s = p.trim();
            if (s.isEmpty() || s.equals(".") || s.equals("..")) continue;
            if (sb.length() > 0) sb.append('/');
            sb.append(s);
        }
        return sb.toString();
    }
}
