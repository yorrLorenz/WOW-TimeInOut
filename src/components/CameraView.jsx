import { useRef, useEffect } from 'react';

/**
 * Renders the webcam video + an overlay canvas for face detections.
 * Passes both refs up so parents can run face-api on them.
 */
export default function CameraView({ videoRef, canvasRef, ready, error, className = '' }) {
  return (
    <div className={`relative rounded-xl overflow-hidden bg-black ${className}`}>
      {error ? (
        <div className="flex items-center justify-center h-full min-h-[300px] text-red-400 p-4 text-center">
          {error}
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
          />
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-sm">
              Starting camera...
            </div>
          )}
        </>
      )}
    </div>
  );
}
