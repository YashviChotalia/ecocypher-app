import jsQR from 'jsqr';
import { Camera, ImageUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };

function decodeCanvas(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

/** Camera QR scanner with a photo-upload fallback. Calls onText with each decoded value. */
export function QrScanner({ onText }: { onText: (text: string) => boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<'idle' | 'starting' | 'on' | 'denied' | 'unsupported'>('idle');
  const [error, setError] = useState<string | null>(null);
  const stop = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };

  const start = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) { setState('unsupported'); return; }
    setState('starting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = s;
      if (videoRef.current) { videoRef.current.srcObject = s; await videoRef.current.play(); }
      setState('on');
    } catch { setState('denied'); }
  };

  useEffect(() => {
    if (state !== 'on') return;
    let raf = 0, busy = false;
    const canvas = document.createElement('canvas');
    const Native = (window as unknown as { BarcodeDetector?: new (o: object) => Detector }).BarcodeDetector;
    const det = Native ? new Native({ formats: ['qr_code'] }) : null;
    const tick = async () => {
      const v = videoRef.current;
      if (v && v.readyState >= 2 && !busy) {
        busy = true;
        try {
          let text: string | null;
          if (det) text = (await det.detect(v))[0]?.rawValue ?? null;
          else {
            const k = 480 / Math.max(v.videoWidth, v.videoHeight);
            canvas.width = Math.round(v.videoWidth * k); canvas.height = Math.round(v.videoHeight * k);
            canvas.getContext('2d')?.drawImage(v, 0, 0, canvas.width, canvas.height);
            text = decodeCanvas(canvas);
          }
          if (text) {
            if (onText(text)) { stop(); setState('idle'); return; }
            setError('That QR code is not an EcoCypher evidence receipt.');
          }
        } catch { /* keep scanning */ }
        busy = false;
      }
      raf = requestAnimationFrame(() => void tick());
    };
    raf = requestAnimationFrame(() => void tick());
    return () => cancelAnimationFrame(raf);
  }, [state, onText]);
  useEffect(() => () => stop(), []);

  const onFile = async (file?: File) => {
    if (!file) return;
    setError(null);
    try {
      const bmp = await createImageBitmap(file);
      const c = document.createElement('canvas');
      const k = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height);
      const text = decodeCanvas(c);
      if (!text) setError('No QR code found in that image. Try a sharper, closer photo.');
      else if (!onText(text)) setError('That QR code is not an EcoCypher evidence receipt.');
    } catch { setError('That file could not be read as an image.'); }
  };

  return (
    <div className="stack">
      <div className="viewfinder">
        <video ref={videoRef} playsInline muted hidden={state !== 'on'} />
        {state === 'on' ? (<><div className="frame" aria-hidden /><div className="scanline" aria-hidden /></>) : (
          <div className="placeholder">
            <Camera aria-hidden />
            <p>{state === 'denied' ? 'Camera access was blocked. Allow it in your browser settings, or upload a photo.' : state === 'unsupported' ? 'This browser can’t open the camera. Upload a photo instead.' : 'Point your back camera at the QR receipt.'}</p>
            <button type="button" className="btn btn-gold" onClick={() => void start()} disabled={state === 'starting' || state === 'unsupported'}>{state === 'starting' ? 'Opening camera…' : 'Start camera'}</button>
          </div>
        )}
      </div>
      {state === 'on' && <button type="button" className="btn btn-ghost" onClick={() => { stop(); setState('idle'); }}>Stop camera</button>}
      {error && <div className="note fail" role="alert">{error}</div>}
      <label className="btn btn-ghost btn-block" style={{ cursor: 'pointer' }}>
        <ImageUp aria-hidden /> Upload a photo of the QR code
        <input type="file" accept="image/*" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>
    </div>
  );
}
