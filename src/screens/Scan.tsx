import jsQR from 'jsqr';
import { Camera, ImageUp, Keyboard } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PageHeader, toast } from '../components/ui';
import { extractEvidenceId } from '../lib/qr';
import { navigate } from '../lib/router';

type BarcodeDetectorLike = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };

function decodeCanvas(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

export function Scan() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<'idle' | 'starting' | 'on' | 'denied' | 'unsupported'>('idle');
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleText = (text: string) => {
    const id = extractEvidenceId(text);
    if (!id) {
      setError('That QR code is not an EcoCypher evidence receipt.');
      return false;
    }
    stop();
    if (navigator.vibrate) navigator.vibrate(30);
    navigate({ name: 'verify', id });
    return true;
  };

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const start = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('unsupported');
      return;
    }
    setCamera('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play();
      }
      setCamera('on');
    } catch {
      setCamera('denied');
    }
  };

  // Decode loop: native BarcodeDetector where available, jsQR everywhere else.
  useEffect(() => {
    if (camera !== 'on') return;
    let raf = 0;
    let busy = false;
    const canvas = document.createElement('canvas');
    const Native = (window as unknown as { BarcodeDetector?: new (o: object) => BarcodeDetectorLike }).BarcodeDetector;
    const detector = Native ? new Native({ formats: ['qr_code'] }) : null;
    const tick = async () => {
      const v = videoRef.current;
      if (v && v.readyState >= 2 && !busy) {
        busy = true;
        try {
          let text: string | null = null;
          if (detector) {
            text = (await detector.detect(v))[0]?.rawValue ?? null;
          } else {
            const scale = 480 / Math.max(v.videoWidth, v.videoHeight);
            canvas.width = Math.round(v.videoWidth * scale);
            canvas.height = Math.round(v.videoHeight * scale);
            canvas.getContext('2d')?.drawImage(v, 0, 0, canvas.width, canvas.height);
            text = decodeCanvas(canvas);
          }
          if (text && handleText(text)) return;
        } catch {
          /* keep scanning */
        }
        busy = false;
      }
      raf = requestAnimationFrame(() => void tick());
    };
    raf = requestAnimationFrame(() => void tick());
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  useEffect(() => () => stop(), []);

  const onFile = async (file?: File) => {
    if (!file) return;
    setError(null);
    try {
      const bmp = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const text = decodeCanvas(canvas);
      if (!text) setError('No QR code found in that image. Try a sharper, closer photo.');
      else handleText(text);
    } catch {
      setError('That file could not be read as an image.');
    }
  };

  return (
    <>
      <PageHeader eyebrow="Scan" title="Scan a QR receipt">
        Every EcoCypher evidence record carries a QR code. Scan it to recompute its fingerprint and confirm nothing was changed.
      </PageHeader>

      <div className="viewfinder">
        <video ref={videoRef} playsInline muted hidden={camera !== 'on'} />
        {camera === 'on' ? (
          <>
            <div className="frame" aria-hidden />
            <div className="scanline" aria-hidden />
          </>
        ) : (
          <div className="placeholder">
            <Camera aria-hidden />
            {camera === 'denied' && <p>Camera access was blocked. Allow it in your browser settings, or upload a photo below.</p>}
            {camera === 'unsupported' && <p>This browser can’t open the camera. Upload a photo of the QR code instead.</p>}
            {(camera === 'idle' || camera === 'starting') && <p>Use your back camera to read the code.</p>}
            <button className="btn btn-gold" onClick={() => void start()} disabled={camera === 'starting' || camera === 'unsupported'}>
              {camera === 'starting' ? 'Opening camera…' : 'Start camera'}
            </button>
          </div>
        )}
      </div>
      {camera === 'on' && (
        <button className="btn btn-ghost" onClick={() => { stop(); setCamera('idle'); }}>Stop camera</button>
      )}

      {error && <div className="chip fail" role="alert" style={{ justifySelf: 'start', whiteSpace: 'normal' }}>{error}</div>}

      <label className="btn btn-ghost btn-block" style={{ cursor: 'pointer' }}>
        <ImageUp aria-hidden /> Upload a photo of the QR code
        <input type="file" accept="image/*" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>

      <div className="divider">or enter it yourself</div>

      <form
        className="card flat stack"
        onSubmit={(e) => {
          e.preventDefault();
          const id = extractEvidenceId(manual) ?? manual.trim().toUpperCase();
          if (!id) return;
          navigate({ name: 'verify', id });
        }}
      >
        <label className="field" htmlFor="manual-id">
          Evidence ID or verification link
          <span className="hint">For example EVD-88A9F34C2B10, or a link from a receipt.</span>
        </label>
        <input id="manual-id" className="input mono" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="EVD-…" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
        <button className="btn btn-primary" type="submit" disabled={!manual.trim()}>
          <Keyboard aria-hidden /> Verify
        </button>
        <button type="button" className="link" style={{ background: 'none', border: 0, cursor: 'pointer', justifySelf: 'start', padding: 0 }}
          onClick={() => { setManual('EVD-88A9F34C2B10'); toast('Sample ID filled in'); }}>
          Try a sample ID
        </button>
      </form>
    </>
  );
}
