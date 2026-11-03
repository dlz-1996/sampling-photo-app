package cn.dlz.samplingphoto;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

/** 读相机原图：按 EXIF 转正、缩到长边 maxEdge、压成 JPEG 再交给网页 */
public class ImageUtil {

    public static String toDataUrl(File file, int maxEdge, int quality) throws IOException {
        Bitmap bmp = load(file, maxEdge);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.JPEG, clampQuality(quality), out);
        bmp.recycle();
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(),
                Base64.NO_WRAP);
    }

    /** 转正 + 缩放后写到同目录的 p_ 前缀文件，返回该文件 */
    public static File process(File file, int maxEdge, int quality) throws IOException {
        Bitmap bmp = load(file, maxEdge);
        File out = new File(file.getParentFile(), "p_" + file.getName());
        FileOutputStream fos = new FileOutputStream(out);
        try {
            if (!bmp.compress(Bitmap.CompressFormat.JPEG, clampQuality(quality), fos)) {
                throw new IOException("照片编码失败");
            }
            fos.flush();
        } finally {
            try { fos.close(); } catch (Throwable ignored) { }
            bmp.recycle();
        }
        if (!out.isFile() || out.length() == 0) throw new IOException("照片写入失败");
        return out;
    }

    private static int clampQuality(int quality) {
        return Math.max(1, Math.min(quality, 100));
    }

    /** 按 EXIF 转正、缩到长边 maxEdge，返回可安全复用的 Bitmap */
    private static Bitmap load(File file, int maxEdge) throws IOException {
        String path = file.getAbsolutePath();

        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(path, bounds);
        int w = bounds.outWidth;
        int h = bounds.outHeight;
        if (w <= 0 || h <= 0) throw new IOException("图片无法解析");

        int sample = 1;
        while (Math.max(w / (sample * 2), h / (sample * 2)) > maxEdge) sample *= 2;

        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        Bitmap bmp = BitmapFactory.decodeFile(path, opts);
        if (bmp == null) throw new IOException("图片解码失败");

        int rotation = 0;
        boolean flip = false;
        try {
            ExifInterface exif = new ExifInterface(path);
            int o = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION,
                    ExifInterface.ORIENTATION_NORMAL);
            switch (o) {
                case ExifInterface.ORIENTATION_ROTATE_90: rotation = 90; break;
                case ExifInterface.ORIENTATION_ROTATE_180: rotation = 180; break;
                case ExifInterface.ORIENTATION_ROTATE_270: rotation = 270; break;
                case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: flip = true; break;
                case ExifInterface.ORIENTATION_TRANSPOSE: rotation = 90; flip = true; break;
                case ExifInterface.ORIENTATION_TRANSVERSE: rotation = 270; flip = true; break;
                default: break;
            }
        } catch (Throwable ignored) { }

        int longest = Math.max(bmp.getWidth(), bmp.getHeight());
        if (longest > maxEdge) {
            float k = (float) maxEdge / longest;
            int nw = Math.max(1, Math.round(bmp.getWidth() * k));
            int nh = Math.max(1, Math.round(bmp.getHeight() * k));
            Bitmap scaled = Bitmap.createScaledBitmap(bmp, nw, nh, true);
            if (scaled != bmp) bmp.recycle();
            bmp = scaled;
        }

        if (rotation != 0 || flip) {
            Matrix m = new Matrix();
            if (rotation != 0) m.postRotate(rotation);
            if (flip) m.postScale(-1f, 1f);
            Bitmap rotated = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(),
                    m, true);
            if (rotated != bmp) bmp.recycle();
            bmp = rotated;
        }

        return bmp;
    }
}
