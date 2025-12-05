import React, { useRef, useEffect, useState, useCallback } from 'react';
import { analyzeImageWithGemini } from '../services/geminiService';
import { AnalysisResult } from '../types';

interface CameraCaptureProps {
  apiKey: string;
  onAnalysisComplete: (result: AnalysisResult) => void;
}

const CameraCapture: React.FC<CameraCaptureProps> = ({ apiKey, onAnalysisComplete }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Helper to stop all tracks
  const stopTracks = (stream: MediaStream | null) => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
  };

  const startCamera = useCallback(async () => {
    setIsStreaming(false);
    setError(null);

    // 0. Check API Support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("Camera API not supported. Please use a modern browser and ensure you are on HTTPS.");
      return;
    }

    try {
      let stream: MediaStream | null = null;
      let lastError: unknown = null;

      // 1. Strategy List: Try specific constraints first, then loosen them
      const strategies = [
        // Strategy A: Prefer back camera (environment)
        { video: { facingMode: 'environment' }, audio: false },
        // Strategy B: Prefer front camera (user) - sometimes environment fails on desktops/specific tablets
        { video: { facingMode: 'user' }, audio: false },
        // Strategy C: Any video device
        { video: true, audio: false }
      ];

      for (const constraints of strategies) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (stream) {
             console.log("Camera acquired with constraints:", constraints);
             break;
          }
        } catch (e) {
          console.warn("Camera strategy failed:", constraints, e);
          lastError = e;
        }
      }

      if (!stream) {
        // If we exhausted all strategies and still no stream, throw the last error
        throw lastError || new Error("No camera devices found.");
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        // 2. Explicit play call for mobile browsers
        videoRef.current.onloadedmetadata = async () => {
          try {
            await videoRef.current?.play();
            setIsStreaming(true);
          } catch (playError) {
            console.error("Video play failed:", playError);
            setError("Camera permission granted, but video preview failed to start.");
          }
        };
      } else {
        // Cleanup if component unmounted during setup
        stopTracks(stream);
      }
    } catch (err: any) {
      console.error("Camera access error:", err);
      
      let msg = "Unable to access camera.";
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = "Camera permission denied. Please reset permissions for this site in your browser settings.";
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = "No camera device found on this device.";
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        msg = "Camera is currently in use by another application. Please close other apps and try again.";
      } else if (err.name === 'OverconstrainedError') {
        msg = "Camera constraints could not be satisfied.";
      } else if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
        msg = "Camera access requires a secure HTTPS connection.";
      }

      setError(msg);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stopTracks(stream);
      videoRef.current.srcObject = null;
      setIsStreaming(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    
    // Slight delay to ensure UI is painted before requesting heavy resources
    const timer = setTimeout(() => {
        if (isMounted) startCamera();
    }, 100);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
         if (isMounted && !videoRef.current?.srcObject && !error) {
             startCamera();
         }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      stopCamera();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [startCamera, stopCamera, error]);

  const captureAndAnalyze = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setAnalyzing(true);
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (context) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = canvas.toDataURL('image/jpeg', 0.8);
      
      try {
        const response = await analyzeImageWithGemini(apiKey, imageData);
        
        const result: AnalysisResult = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          imageData: imageData,
          description: response.text
        };

        onAnalysisComplete(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Analysis failed");
      } finally {
        setAnalyzing(false);
      }
    }
  }, [apiKey, onAnalysisComplete]);

  return (
    <div className="flex flex-col h-full w-full max-w-2xl mx-auto">
      <div className="relative flex-grow bg-zinc-900 rounded-2xl overflow-hidden shadow-xl border border-zinc-800 flex flex-col justify-center min-h-[50vh]">
        {/* Loading State */}
        {!isStreaming && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-500 z-10 flex-col gap-2">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-zinc-500"></div>
            <span className="text-sm">Starting Camera...</span>
          </div>
        )}
        
        {/* Error State */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-red-400 p-6 text-center z-20 bg-zinc-900">
             <div className="flex flex-col items-center gap-4">
               <div className="bg-red-900/20 p-3 rounded-full">
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor">
                   <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                 </svg>
               </div>
               <div className="space-y-1">
                  <h3 className="font-semibold text-white">Camera Error</h3>
                  <p className="text-sm text-zinc-400 max-w-xs mx-auto leading-relaxed">{error}</p>
               </div>
               <button 
                  onClick={() => { setError(null); startCamera(); }}
                  className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-full text-sm font-semibold text-white transition-colors border border-zinc-700"
               >
                 Retry Connection
               </button>
             </div>
          </div>
        )}

        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover transition-opacity duration-700 ${isStreaming ? 'opacity-100' : 'opacity-0'}`}
        />
        
        <canvas ref={canvasRef} className="hidden" />

        {/* Analyzing Overlay */}
        {analyzing && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-30 backdrop-blur-md">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4 shadow-[0_0_15px_rgba(59,130,246,0.5)]"></div>
            <p className="text-white font-medium animate-pulse tracking-wide">Analyzing with Gemini...</p>
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-center pb-4">
        <button
          onClick={captureAndAnalyze}
          disabled={!isStreaming || analyzing}
          className="group relative flex items-center justify-center transition-all disabled:opacity-50"
          aria-label="Capture and Analyze"
        >
          <div className={`rounded-full p-1 bg-gradient-to-tr from-blue-600 to-indigo-500 transition-transform duration-200 ${!analyzing && isStreaming ? 'group-hover:scale-105 group-active:scale-95' : ''}`}>
             <div className="h-16 w-16 bg-white rounded-full border-[3px] border-black relative overflow-hidden flex items-center justify-center">
                {!isStreaming && !analyzing && <div className="w-2 h-2 bg-zinc-300 rounded-full"></div>}
                <div className="absolute inset-0 bg-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"></div>
             </div>
          </div>
        </button>
      </div>
      <p className="text-center text-zinc-500 text-xs mt-1 font-medium tracking-wide opacity-60">
        {!isStreaming && !error ? "Waiting for camera..." : "Tap button to analyze"}
      </p>
    </div>
  );
};

export default CameraCapture;