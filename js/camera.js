/* 相机与定位控制 */

export class CameraController {
  constructor({ video, onGps, onError }) {
    this.video = video;
    this.onGps = onGps || (() => {});
    this.onError = onError || (() => {});
    this.stream = null;
    this.track = null;
    this.torchOn = false;
    this.wakeLock = null;
    this.watchId = null;
    this.fix = null;
    this.gpsState = 'idle';
    this.stopped = false;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error('当前环境不支持调用相机');
      err.name = 'NotSupportedError';
      throw err;
    }
    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 2560 },
        height: { ideal: 1440 },
      },
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (this.stopped) {
      this.stream.getTracks().forEach(t => t.stop());
      return;
    }
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    this.track = this.stream.getVideoTracks()[0];
    try {
      this.startGps();
    } catch (e) {
      this.gpsState = 'unavailable';
      this.onGps({ state: 'unavailable', message: e?.message });
    }
    this.requestWakeLock();
  }

  startGps() {
    if (!navigator.geolocation) {
      this.gpsState = 'unsupported';
      this.onGps({ state: 'unsupported' });
      return;
    }
    this.gpsState = 'locating';
    this.onGps({ state: 'locating' });
    this.watchId = navigator.geolocation.watchPosition(
      pos => {
        this.fix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          at: Date.now(),
        };
        this.gpsState = 'ok';
        this.onGps({ state: 'ok', ...this.fix });
      },
      err => {
        this.gpsState = err.code === 1 ? 'denied' : 'unavailable';
        this.onGps({ state: this.gpsState, message: err.message });
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
  }

  /** 拍照时取 45 秒内的定位，过期则视为无定位 */
  currentFix(maxAge = 45000) {
    if (!this.fix) return null;
    if (Date.now() - this.fix.at > maxAge) return null;
    return this.fix;
  }

  async requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch {}
  }

  async toggleTorch() {
    if (!this.track) return false;
    const caps = this.track.getCapabilities?.() || {};
    if (!caps.torch) throw new Error('当前摄像头不支持补光灯');
    this.torchOn = !this.torchOn;
    await this.track.applyConstraints({ advanced: [{ torch: this.torchOn }] });
    return this.torchOn;
  }

  async stop() {
    this.stopped = true;
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    if (this.torchOn && this.track) {
      try { await this.track.applyConstraints({ advanced: [{ torch: false }] }); } catch {}
    }
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.track = null;
    if (this.video) this.video.srcObject = null;
    try { await this.wakeLock?.release(); } catch {}
    this.wakeLock = null;
  }
}
