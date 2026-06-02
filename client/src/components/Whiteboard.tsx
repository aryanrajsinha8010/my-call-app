import React, { useRef, useState, useEffect } from 'react';
import { 
  Trash2, RotateCcw, RotateCw, Download, PenTool, Eraser, 
  FolderOpen, UploadCloud, Palette, Sliders, CloudLightning,
  Sparkles, Check, AlertCircle, RefreshCw, Type, Image,
  Square, Circle, Minus, ArrowRight, Lock, MousePointer
} from 'lucide-react';
import { Socket } from 'socket.io-client';
import { encryptText, decryptText } from '../lib/e2ee.ts';

interface ShapeData {
  type: 'rectangle' | 'circle' | 'line' | 'arrow';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  color: string;
  size: number;
  fill?: boolean;
}

interface WhiteboardProps {
  socket: Socket | null;
  roomName: string;
  e2eeKey?: CryptoKey | null;
  isLinkedToShareScreen?: boolean;
  setIsLinkedToShareScreen?: (val: boolean) => void;
  linkedStreamId?: string | null;
  setLinkedStreamId?: (val: string | null) => void;
  isCalibrating?: boolean;
  setIsCalibrating?: (val: boolean) => void;
  calibrationPoints?: Array<{x: number; y: number}>;
  setCalibrationPoints?: (pts: Array<{x: number; y: number}>) => void;
  participants?: any[];
  screenStream?: MediaStream | null;
}

interface Stroke {
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  color: string;
  size: number;
  isEraser: boolean;
}

interface RemoteCursor {
  socketId: string;
  username: string;
  x: number;
  y: number;
  isLaser: boolean;
  color: string;
  active: boolean;
  isDrawing: boolean;
  lastSeen: number;
}

export default function Whiteboard({ 
  socket, 
  roomName, 
  e2eeKey,
  isLinkedToShareScreen = false,
  setIsLinkedToShareScreen,
  linkedStreamId = null,
  setLinkedStreamId,
  isCalibrating = false,
  setIsCalibrating,
  setCalibrationPoints,
  screenStream = null
}: WhiteboardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#dcb16b'); // Start with the premium golden color
  const [brushSize, setBrushSize] = useState(4);
  const [tool, setTool] = useState<'pen' | 'eraser' | 'text' | 'image' | 'rectangle' | 'circle' | 'line' | 'arrow' | 'laser'>('pen');
  const [fillShapes, setFillShapes] = useState(false);
  const [annotationText, setAnnotationText] = useState('Annotation');
  const [fontSize, setFontSize] = useState(16);
  const [imageUrl, setImageUrl] = useState('');
  const [imageWidth, setImageWidth] = useState(200);
  const [imageHeight, setImageHeight] = useState(150);
  const [isImageValid, setIsImageValid] = useState<boolean | null>(null);
  const [isImageLoading, setIsImageLoading] = useState(false);
  
  // Real-time Collaborative Presentation, Cursors and Laser Pointer Refs & States
  const [remoteCursors, setRemoteCursors] = useState<Record<string, RemoteCursor>>({});
  
  // Overlays and hover states for Linked Screen
  const [localOverlayHover, setLocalOverlayHover] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const handleLocalHover = (e: CustomEvent<any>) => {
      const { x, y, active } = e.detail;
      if (active) {
        setLocalOverlayHover({ x, y });
      } else {
        setLocalOverlayHover(null);
      }
    };
    window.addEventListener('local-hover-pointer' as any, handleLocalHover);
    return () => {
      window.removeEventListener('local-hover-pointer' as any, handleLocalHover);
    };
  }, []);

  const localMouseCoords = useRef<{ x: number; y: number; visible: boolean }>({ x: 0, y: 0, visible: false });
  const localLaserPath = useRef<{ x: number; y: number; timestamp: number }[]>([]);
  const remoteLaserPaths = useRef<Record<string, { x: number; y: number; timestamp: number }[]>>({});
  const lastEmitTime = useRef<number>(0);
  const animationFrameId = useRef<number | null>(null);

  // Resolve current username safely with robust fallbacks
  const userName = (typeof window !== 'undefined' ? sessionStorage.getItem('nexalink_username') : null) || 'Anonymous';

  // History Stacks for Local Undo/Redo
  const [history, setHistory] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const lastPos = useRef({ x: 0, y: 0 });
  const startImageDataRef = useRef<ImageData | null>(null);
  const currentPos = useRef({ x: 0, y: 0 });

  const drawShapeOnCtx = (
    ctx: CanvasRenderingContext2D,
    shapeType: 'rectangle' | 'circle' | 'line' | 'arrow',
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    fill = false
  ) => {
    ctx.beginPath();
    if (shapeType === 'rectangle') {
      ctx.rect(startX, startY, endX - startX, endY - startY);
      if (fill) {
        ctx.fill();
      } else {
        ctx.stroke();
      }
    } else if (shapeType === 'circle') {
      const radius = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
      ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
      if (fill) {
        ctx.fill();
      } else {
        ctx.stroke();
      }
    } else if (shapeType === 'line') {
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    } else if (shapeType === 'arrow') {
      const angle = Math.atan2(endY - startY, endX - startX);
      const arrowLength = 15 + brushSize; // scale arrowhead with brush size
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(
        endX - arrowLength * Math.cos(angle - Math.PI / 6),
        endY - arrowLength * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        endX - arrowLength * Math.cos(angle + Math.PI / 6),
        endY - arrowLength * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
    }
  };

  // Cloud Whiteboard Storage States
  const [cloudSnapshots, setCloudSnapshots] = useState<{ id: string; url: string; saved_by: string; created_at: string }[]>([]);
  const [isSavingCloud, setIsSavingCloud] = useState(false);
  const [isLoadingCloud, setIsLoadingCloud] = useState(false);
  const [showSnapshotsList, setShowSnapshotsList] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // SEC-15 FIX: Load API base URL from env variables instead of hardcoding localhost
  const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8001';

  // SEC-08 FIX: Validate that a URL belongs to our trusted Supabase storage domain
  // before loading it into the canvas. Prevents SSRF and malicious image injection
  // from compromised peers emitting remote_load events with arbitrary URLs.
  const isAllowedSnapshotUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return (
        parsed.protocol === 'https:' &&
        (parsed.hostname === 'uejwhikwtjikrsbnaabo.supabase.co' ||
         parsed.hostname.endsWith('.supabase.co'))
      );
    } catch {
      return false; // invalid URL format
    }
  };

  // Helper to dynamically translate any theme/custom peach colors to premium golden color (#dcb16b)
  const convertPeachToGold = (c: string): string => {
    const normalized = c.toLowerCase().trim();
    if (
      normalized === '#e39a7a' || 
      normalized === '#ffd4ac' || 
      normalized === '#ffb6ac' || 
      normalized === '#ffebe2' || 
      normalized === '#f43f5e'
    ) {
      return '#dcb16b'; // Premium Muted Golden Sand
    }
    return c;
  };

  // Dynamic pixel manipulator to sweep loaded snapshots and swap peach pixels with golden pixels
  const replacePeachPixelsWithGold = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    try {
      const imgData = ctx.getImageData(0, 0, width, height);
      const data = imgData.data;
      
      // Target peach colors in RGB
      const peachColors = [
        { r: 227, g: 154, b: 122 }, // #e39a7a
        { r: 255, g: 212, b: 172 }, // #ffd4ac
        { r: 255, g: 182, b: 172 }, // #ffb6ac
        { r: 255, g: 235, b: 226 }, // #ffebe2
        { r: 244, g: 63, b: 94 }    // #f43f5e
      ];
      
      // Gold replacement color in RGB (#dcb16b)
      const goldR = 220;
      const goldG = 177;
      const goldB = 107;
      
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i+1];
        const b = data[i+2];
        const a = data[i+3];
        
        if (a === 0) continue; // transparent pixel
        
        for (const peach of peachColors) {
          const dist = Math.sqrt(
            Math.pow(r - peach.r, 2) +
            Math.pow(g - peach.g, 2) +
            Math.pow(b - peach.b, 2)
          );
          
          if (dist < 35) { // Match tolerance
            data[i] = goldR;
            data[i+1] = goldG;
            data[i+2] = goldB;
            break;
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
    } catch (e) {
      console.error("Failed to process image pixels for color replacement:", e);
    }
  };

  const showToast = (text: string, type: 'success' | 'error') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Fetch past whiteboard snapshots from Supabase DB via our backend API
  const fetchCloudSnapshots = async () => {
    setIsLoadingCloud(true);
    try {
      const token = sessionStorage.getItem('nexalink_token');
      const res = await fetch(`${API_BASE}/api/whiteboard/list/${roomName}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const data = await res.json();
        setCloudSnapshots(data);
      }
    } catch (e) {
      console.error("Failed to fetch cloud snapshots:", e);
    } finally {
      setIsLoadingCloud(false);
    }
  };

  useEffect(() => {
    fetchCloudSnapshots();
  }, [roomName]);

  // Real-time URL Validator and Image Preview Loader
  useEffect(() => {
    const cleanUrl = imageUrl.trim();
    if (!cleanUrl) {
      setIsImageValid(null);
      setIsImageLoading(false);
      return;
    }

    setIsImageLoading(true);
    setIsImageValid(null);

    const img = new window.Image();
    img.src = cleanUrl;
    img.onload = () => {
      setIsImageValid(true);
      setIsImageLoading(false);
    };
    img.onerror = () => {
      setIsImageValid(false);
      setIsImageLoading(false);
    };
  }, [imageUrl]);

  // Load a whiteboard snapshot from a URL
  const loadWhiteboardFromUrl = (url: string, broadcast = true) => {
    // SEC-08 FIX: Validate URL before loading into canvas to prevent SSRF
    // and arbitrary content injection from malicious peers via remote_load events.
    if (!isAllowedSnapshotUrl(url)) {
      console.error('[Security] Blocked whiteboard load from untrusted URL:', url);
      showToast("Security: Blocked untrusted URL injection", "error");
      return;
    }

    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    if (!canvas || !ctx) return;

    saveState();
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      
      // Dynamic color replacement from peach to golden!
      replacePeachPixelsWithGold(ctx, canvas.width, canvas.height);
      
      showToast("Snapshot loaded into viewport", "success");
    };
    img.onerror = () => {
      console.error('[Whiteboard] Failed to load image from URL:', url);
      showToast("Failed to load snapshot from cloud", "error");
    };

    if (broadcast && socket) {
      (async () => {
        let finalUrl = url;
        if (e2eeKey) {
          try {
            finalUrl = await encryptText(url, e2eeKey);
          } catch (err) {
            console.error("Whiteboard load URL encryption failed:", err);
          }
        }
        socket.emit('load_whiteboard', { roomName, url: finalUrl });
      })();
    }
  };

  // Upload canvas PNG to Supabase Storage
  const cloudSaveBoard = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsSavingCloud(true);
    try {
      // 1. Get Blob from Canvas
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error("Failed to get image blob from canvas");

      // 2. Generate unique filename
      const filename = `drawing-${roomName}-${Date.now()}.png`;

      // 3. Upload to Supabase Storage using client-side library
      const { supabase } = await import('../lib/supabaseClient.ts');
      const { error } = await supabase.storage
        .from('nexalink-drawings')
        .upload(filename, blob, { contentType: 'image/png', upsert: true });

      if (error) throw error;

      // 4. Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('nexalink-drawings')
        .getPublicUrl(filename);

      // 5. Save metadata in backend API (SEC-09: token sent so server uses JWT identity)
      const token = sessionStorage.getItem('nexalink_token');
      const saveRes = await fetch(`${API_BASE}/api/whiteboard/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          room_name: roomName,
          url: publicUrl,
          username: sessionStorage.getItem('nexalink_username') || 'anonymous'
        })
      });

      if (!saveRes.ok) throw new Error("Failed to save snapshot metadata");

      showToast("Whiteboard snapshot saved to Supabase!", "success");
      fetchCloudSnapshots();
    } catch (e: any) {
      console.error(e);
      showToast(`Cloud Save failed: ${e.message || e}`, "error");
    } finally {
      setIsSavingCloud(false);
    }
  };

  const getCanvasContext = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext('2d');
  };

  // Push current canvas state to history stack
  const saveState = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataURL = canvas.toDataURL();
    setHistory(prev => [...prev, dataURL]);
    setRedoStack([]); // Clear redo stack on new action
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setImageUrl(event.target.result as string);
          showToast("Local image uploaded. Click on whiteboard to place it.", "success");
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleStartDraw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    if (tool !== 'laser') {
      saveState();
    }
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    if (tool === 'laser') {
      localLaserPath.current = [{ x, y, timestamp: Date.now() }];
      setIsDrawing(true);
      emitCursor({ x, y, active: true, isDrawing: true });
      return;
    }
    
    if (tool === 'text') {
      const textToDraw = annotationText.trim();
      if (!textToDraw) {
        showToast("Type text in the annotation input field first", "error");
        return;
      }
      const ctx = getCanvasContext();
      if (ctx) {
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillStyle = convertPeachToGold(color);
        ctx.fillText(textToDraw, x, y);
        
        // Sync text drawing with peers over custom text_event
        if (socket) {
          const textData = {
            x,
            y,
            text: textToDraw,
            color: convertPeachToGold(color),
            fontSize
          };
          (async () => {
            let finalTextData: any = textData;
            if (e2eeKey) {
              try {
                finalTextData = await encryptText(JSON.stringify(textData), e2eeKey);
              } catch (err) {
                console.error("Text annotation encryption failed:", err);
              }
            }
            socket.emit('text_event', {
              roomName,
              textData: finalTextData
            });
          })();
        }
        showToast("Text annotation placed", "success");
      }
      return;
    }

    if (tool === 'image') {
      const urlToDraw = imageUrl.trim();
      if (!urlToDraw) {
        showToast("Paste a URL or upload a local image first", "error");
        return;
      }
      const ctx = getCanvasContext();
      if (ctx) {
        const img = new window.Image();
        img.crossOrigin = "anonymous";
        img.src = urlToDraw;
        img.onload = () => {
          const startX = x - imageWidth / 2;
          const startY = y - imageHeight / 2;
          ctx.drawImage(img, startX, startY, imageWidth, imageHeight);
          
          // Sync drawing with peers over socket
          if (socket) {
            const imageData = {
              x: startX,
              y: startY,
              url: urlToDraw,
              width: imageWidth,
              height: imageHeight
            };
            (async () => {
              let finalImageData: any = imageData;
              if (e2eeKey) {
                try {
                  finalImageData = await encryptText(JSON.stringify(imageData), e2eeKey);
                } catch (err) {
                  console.error("Image annotation encryption failed:", err);
                }
              }
              socket.emit('image_event', {
                roomName,
                imageData: finalImageData
              });
            })();
          }
          showToast("Image annotation placed", "success");
        };
        img.onerror = () => {
          showToast("Failed to load image. Ensure it is a valid direct link.", "error");
        };
      }
      return;
    }

    if (['rectangle', 'circle', 'line', 'arrow'].includes(tool)) {
      const ctx = getCanvasContext();
      if (ctx) {
        startImageDataRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
      lastPos.current = { x, y };
      currentPos.current = { x, y };
      setIsDrawing(true);
      return;
    }
    
    lastPos.current = { x, y };
    setIsDrawing(true);
  };

  const handleDraw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Track local coordinates for cursor badge and presentation layer
    localMouseCoords.current = { x, y, visible: true };

    // Emit live cursor coordinate throttled
    emitCursor({ x, y, active: true, isDrawing });

    currentPos.current = { x, y };

    // Dispatch whiteboard hover pointer coordinate event
    window.dispatchEvent(new CustomEvent('whiteboard-hover-pointer', {
      detail: { x, y, active: true }
    }));

    if (tool === 'laser') {
      if (isDrawing) {
        localLaserPath.current.push({ x, y, timestamp: Date.now() });
      }
      return;
    }

    if (!isDrawing || tool === 'text') return;

    if (['rectangle', 'circle', 'line', 'arrow'].includes(tool)) {
      if (startImageDataRef.current) {
        ctx.putImageData(startImageDataRef.current, 0, 0);
        ctx.lineWidth = brushSize;
        ctx.strokeStyle = convertPeachToGold(color);
        ctx.fillStyle = convertPeachToGold(color);
        ctx.lineCap = 'round';
        
        drawShapeOnCtx(
          ctx,
          tool as 'rectangle' | 'circle' | 'line' | 'arrow',
          lastPos.current.x,
          lastPos.current.y,
          x,
          y,
          fillShapes
        );
      }
      return;
    }

    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(x, y);
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over'; // Reset
    } else {
      ctx.strokeStyle = convertPeachToGold(color);
      ctx.stroke();
    }

    // Emit drawing events to peers over Socket.IO signaling plane
    if (socket) {
      const strokeData: Stroke = {
        x,
        y,
        lastX: lastPos.current.x,
        lastY: lastPos.current.y,
        color: convertPeachToGold(color),
        size: brushSize,
        isEraser: tool === 'eraser'
      };
      (async () => {
        let finalStrokeData: any = strokeData;
        if (e2eeKey) {
          try {
            finalStrokeData = await encryptText(JSON.stringify(strokeData), e2eeKey);
          } catch (err) {
            console.error("Whiteboard stroke encryption failed:", err);
          }
        }
        socket.emit('draw_event', { roomName, strokeData: finalStrokeData });
      })();
    }

    lastPos.current = { x, y };
  };

  const handleStopDraw = (e?: React.MouseEvent<HTMLCanvasElement>) => {
    // Hide our local cursor and broadcast deactivation to room peers
    localMouseCoords.current.visible = false;
    emitCursor({ x: 0, y: 0, active: false, isDrawing: false });

    // Dispatch whiteboard hover pointer inactive event
    window.dispatchEvent(new CustomEvent('whiteboard-hover-pointer', {
      detail: { active: false }
    }));

    if (!isDrawing) return;
    setIsDrawing(false);

    if (tool === 'laser') {
      return; // Laser trails are temporary and do not record shapes
    }

    if (['rectangle', 'circle', 'line', 'arrow'].includes(tool)) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = e ? (e.clientX - rect.left) * scaleX : currentPos.current.x;
      const y = e ? (e.clientY - rect.top) * scaleY : currentPos.current.y;
      
      const startX = lastPos.current.x;
      const startY = lastPos.current.y;

      // Broadcast shape event to peers
      if (socket) {
        const shapeData = {
          type: tool as 'rectangle' | 'circle' | 'line' | 'arrow',
          startX,
          startY,
          endX: x,
          endY: y,
          color: convertPeachToGold(color),
          size: brushSize,
          fill: fillShapes
        };
        (async () => {
          let finalShapeData: any = shapeData;
          if (e2eeKey) {
            try {
              finalShapeData = await encryptText(JSON.stringify(shapeData), e2eeKey);
            } catch (err) {
              console.error("Whiteboard shape encryption failed:", err);
            }
          }
          socket.emit('shape_event', { roomName, shapeData: finalShapeData });
        })();
      }
    }
    
    startImageDataRef.current = null;
  };

  // Undo action
  const triggerUndo = () => {
    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    if (!canvas || !ctx || history.length === 0) return;

    const currentData = canvas.toDataURL();
    setRedoStack(prev => [...prev, currentData]);

    const previousState = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));

    const img = new window.Image();
    img.src = previousState;
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
  };

  // Redo action
  const triggerRedo = () => {
    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    if (!canvas || !ctx || redoStack.length === 0) return;

    const currentData = canvas.toDataURL();
    setHistory(prev => [...prev, currentData]);

    const nextState = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));

    const img = new window.Image();
    img.src = nextState;
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
  };

  const clearBoard = () => {
    saveState();
    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (socket) {
      socket.emit('clear_whiteboard', { roomName });
    }
    showToast("Whiteboard canvas cleared", "success");
  };

  // Export board as PNG
  const exportBoard = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `nexalink-whiteboard-${roomName}.png`;
    link.href = canvas.toDataURL();
    link.click();
    showToast("Whiteboard exported as PNG", "success");
  };

  // ── REAL-TIME PRESENTATION MODE & DYNAMIC COLLABORATIVE CURSORS ──

  // Emit dynamic real-time collaborative cursor/laser events (E2EE support)
  const emitCursor = (data: { x: number; y: number; active: boolean; isDrawing: boolean }) => {
    if (!socket) return;
    
    const now = Date.now();
    // Throttling: emit at most every 40ms (~25 fps) to save network but keep updates smooth
    if (!data.active || now - lastEmitTime.current > 40) {
      const cursorPayload = {
        x: Math.round(data.x),
        y: Math.round(data.y),
        username: userName,
        isLaser: tool === 'laser',
        color,
        active: data.active,
        isDrawing: data.isDrawing
      };
      
      (async () => {
        let finalPayload: any = cursorPayload;
        if (e2eeKey) {
          try {
            finalPayload = await encryptText(JSON.stringify(cursorPayload), e2eeKey);
          } catch (err) {
            console.error("Cursor coordinate encryption failed:", err);
          }
        }
        socket.emit('cursor_event', { roomName, cursorData: finalPayload });
      })();
      
      if (data.active) {
        lastEmitTime.current = now;
      }
    }
  };

  // Draw high-fidelity lightsaber style laser dot with dynamic outer/inner glow rings
  const drawLaserDot = (ctx: CanvasRenderingContext2D, x: number, y: number, dotColor: string) => {
    ctx.save();
    
    // Outer glow ring
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, 2 * Math.PI);
    ctx.fillStyle = `${dotColor}22`; // highly transparent outer glow
    ctx.fill();

    // Inner glow dot
    ctx.beginPath();
    ctx.arc(x, y, 6.5, 0, 2 * Math.PI);
    ctx.fillStyle = `${dotColor}66`; // medium transparency inner glow
    ctx.fill();

    // Center bright hot core dot
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.restore();
  };

  // Draw multi-layered glowing laser trails that fade smoothly
  const drawLaserTrail = (ctx: CanvasRenderingContext2D, points: { x: number; y: number; timestamp: number }[], trailColor: string) => {
    if (points.length < 2) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const now = Date.now();

    for (let i = 1; i < points.length; i++) {
      const p1 = points[i - 1];
      const p2 = points[i];

      const age = now - p2.timestamp;
      const lifeRatio = Math.max(0, Math.min(1, 1 - age / 1200)); // 1.2s total lifespan
      if (lifeRatio <= 0) continue;

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);

      // Multi-pass lightsaber glow rendering
      // Step 1: Thick neon outer glow
      ctx.lineWidth = brushSize * 2.5 * lifeRatio;
      ctx.strokeStyle = `${trailColor}22`;
      ctx.stroke();

      // Step 2: Medium glowing core
      ctx.lineWidth = brushSize * 1.2 * lifeRatio;
      ctx.strokeStyle = `${trailColor}88`;
      ctx.stroke();

      // Step 3: Hot white center core
      ctx.lineWidth = Math.max(1, brushSize * 0.4 * lifeRatio);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }

    ctx.restore();
  };

  // Start dynamic high-performance overlay rendering loop at 60fps (requestAnimationFrame)
  useEffect(() => {
    let active = true;

    const renderOverlay = () => {
      if (!active) return;

      const overlayCanvas = overlayCanvasRef.current;
      if (!overlayCanvas) {
        animationFrameId.current = requestAnimationFrame(renderOverlay);
        return;
      }

      const ctx = overlayCanvas.getContext('2d');
      if (!ctx) {
        animationFrameId.current = requestAnimationFrame(renderOverlay);
        return;
      }

      // Clear overlay canvas
      ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

      const now = Date.now();

      // 1. Clean up and draw local/remote laser paths
      localLaserPath.current = localLaserPath.current.filter(p => now - p.timestamp < 1200);
      drawLaserTrail(ctx, localLaserPath.current, color);

      for (const [socketId, path] of Object.entries(remoteLaserPaths.current)) {
        remoteLaserPaths.current[socketId] = path.filter(p => now - p.timestamp < 1200);
        const cursor = remoteCursors[socketId];
        const trailColor = cursor ? cursor.color : '#ff3366';
        drawLaserTrail(ctx, remoteLaserPaths.current[socketId], trailColor);
      }

      // 2. Draw local glowing laser dot if tool is active and visible
      if (tool === 'laser' && localMouseCoords.current.visible) {
        drawLaserDot(ctx, localMouseCoords.current.x, localMouseCoords.current.y, color);
      }

      // 3. Draw remote glowing laser dots
      Object.values(remoteCursors).forEach(cur => {
        if (cur.active && cur.isLaser) {
          drawLaserDot(ctx, cur.x, cur.y, cur.color);
        }
      });

      animationFrameId.current = requestAnimationFrame(renderOverlay);
    };

    renderOverlay();

    return () => {
      active = false;
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [tool, color, remoteCursors]);

  // Setup Remote drawing listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('remote_draw', async (stroke: Stroke | string) => {
      let finalStroke: Stroke;
      if (typeof stroke === 'string') {
        if (e2eeKey) {
          try {
            const decrypted = await decryptText(stroke, e2eeKey);
            finalStroke = JSON.parse(decrypted);
          } catch (err) {
            console.warn('[E2EE Whiteboard] Failed to decrypt remote draw stroke:', err);
            return;
          }
        } else {
          console.warn('[E2EE Whiteboard] Received encrypted stroke but no E2EE key is active.');
          return;
        }
      } else {
        finalStroke = stroke;
      }

      const ctx = getCanvasContext();
      if (!ctx) return;

      ctx.beginPath();
      ctx.moveTo(finalStroke.lastX, finalStroke.lastY);
      ctx.lineTo(finalStroke.x, finalStroke.y);
      ctx.lineWidth = finalStroke.size;
      ctx.lineCap = 'round';
      
      if (finalStroke.isEraser) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.strokeStyle = convertPeachToGold(finalStroke.color);
        ctx.stroke();
      }
    });

    socket.on('remote_clear', () => {
      const canvas = canvasRef.current;
      const ctx = getCanvasContext();
      if (canvas && ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    });

    socket.on('remote_load', async ({ url }: { url: string }) => {
      let finalUrl = url;
      if (url.startsWith('[E2EE]:')) {
        if (e2eeKey) {
          try {
            finalUrl = await decryptText(url, e2eeKey);
          } catch (err) {
            console.warn('[E2EE Whiteboard] Failed to decrypt remote load URL:', err);
            return;
          }
        } else {
          console.warn('[E2EE Whiteboard] Received encrypted load URL but no E2EE key is active.');
          return;
        }
      }
      loadWhiteboardFromUrl(finalUrl, false);
    });

    socket.on('remote_text', async (textData: { x: number; y: number; text: string; color: string; fontSize: number } | string) => {
      let finalText: { x: number; y: number; text: string; color: string; fontSize: number };
      if (typeof textData === 'string') {
        if (e2eeKey) {
          try {
            const decrypted = await decryptText(textData, e2eeKey);
            finalText = JSON.parse(decrypted);
          } catch (err) {
            console.warn('[E2EE Whiteboard] Failed to decrypt remote text:', err);
            return;
          }
        } else {
          console.warn('[E2EE Whiteboard] Received encrypted text but no E2EE key is active.');
          return;
        }
      } else {
        finalText = textData;
      }

      const ctx = getCanvasContext();
      if (!ctx) return;
      ctx.font = `${finalText.fontSize}px sans-serif`;
      ctx.fillStyle = convertPeachToGold(finalText.color);
      ctx.fillText(finalText.text, finalText.x, finalText.y);
    });

    socket.on('remote_image', async (imageData: { x: number; y: number; url: string; width: number; height: number } | string) => {
      let finalImage: { x: number; y: number; url: string; width: number; height: number };
      if (typeof imageData === 'string') {
        if (e2eeKey) {
          try {
            const decrypted = await decryptText(imageData, e2eeKey);
            finalImage = JSON.parse(decrypted);
          } catch (err) {
            console.warn('[E2EE Whiteboard] Failed to decrypt remote image:', err);
            return;
          }
        } else {
          console.warn('[E2EE Whiteboard] Received encrypted image but no E2EE key is active.');
          return;
        }
      } else {
        finalImage = imageData;
      }

      const ctx = getCanvasContext();
      if (!ctx) return;
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.src = finalImage.url;
      img.onload = () => {
        ctx.drawImage(img, finalImage.x, finalImage.y, finalImage.width, finalImage.height);
      };
    });

    socket.on('remote_shape', async (shapeData: ShapeData | string) => {
      let finalShape: ShapeData;
      if (typeof shapeData === 'string') {
        if (e2eeKey) {
          try {
            const decrypted = await decryptText(shapeData, e2eeKey);
            finalShape = JSON.parse(decrypted);
          } catch (err) {
            console.warn('[E2EE Whiteboard] Failed to decrypt remote shape:', err);
            return;
          }
        } else {
          console.warn('[E2EE Whiteboard] Received encrypted shape but no E2EE key is active.');
          return;
        }
      } else {
        finalShape = shapeData;
      }

      const canvas = canvasRef.current;
      const ctx = getCanvasContext();
      if (!canvas || !ctx) return;

      saveState();
      
      ctx.lineWidth = finalShape.size;
      ctx.strokeStyle = convertPeachToGold(finalShape.color);
      ctx.fillStyle = convertPeachToGold(finalShape.color);
      ctx.lineCap = 'round';

      drawShapeOnCtx(
        ctx,
        finalShape.type,
        finalShape.startX,
        finalShape.startY,
        finalShape.endX,
        finalShape.endY,
        finalShape.fill
      );
    });

    socket.on('remote_cursor', async ({ socketId, cursorData }: { socketId: string; cursorData: any }) => {
      let finalCursor: any = cursorData;
      if (typeof cursorData === 'string') {
        if (e2eeKey) {
          try {
            const decrypted = await decryptText(cursorData, e2eeKey);
            finalCursor = JSON.parse(decrypted);
          } catch (err) {
            console.warn('[E2EE Whiteboard] Failed to decrypt remote cursor:', err);
            return;
          }
        } else {
          return;
        }
      }

      if (!finalCursor.active) {
        setRemoteCursors(prev => {
          const next = { ...prev };
          delete next[socketId];
          return next;
        });
        delete remoteLaserPaths.current[socketId];
        return;
      }

      setRemoteCursors(prev => ({
        ...prev,
        [socketId]: {
          socketId,
          username: finalCursor.username || 'Anonymous',
          x: finalCursor.x,
          y: finalCursor.y,
          isLaser: finalCursor.isLaser === true,
          color: finalCursor.color || '#ff3366',
          active: true,
          isDrawing: finalCursor.isDrawing === true,
          lastSeen: Date.now()
        }
      }));

      // Append point to remote laser paths ref if active laser drawing
      if (finalCursor.isLaser && finalCursor.isDrawing) {
        if (!remoteLaserPaths.current[socketId]) {
          remoteLaserPaths.current[socketId] = [];
        }
        remoteLaserPaths.current[socketId].push({
          x: finalCursor.x,
          y: finalCursor.y,
          timestamp: Date.now()
        });
      }
    });

    return () => {
      socket.off('remote_draw');
      socket.off('remote_clear');
      socket.off('remote_load');
      socket.off('remote_text');
      socket.off('remote_image');
      socket.off('remote_shape');
      socket.off('remote_cursor');
    };
  }, [socket, e2eeKey]);

  useEffect(() => {
    const handleLocalDrawStroke = (e: CustomEvent<any>) => {
      const { stroke } = e.detail;
      const canvas = canvasRef.current;
      const ctx = getCanvasContext();
      if (!canvas || !ctx) return;
      
      // Draw locally
      ctx.beginPath();
      ctx.moveTo(stroke.lastX, stroke.lastY);
      ctx.lineTo(stroke.x, stroke.y);
      ctx.lineWidth = stroke.size;
      ctx.lineCap = 'round';
      if (stroke.isEraser) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.strokeStyle = convertPeachToGold(stroke.color);
        ctx.stroke();
      }
      
      // Save state
      saveState();
      
      // Emit to peers
      if (socket) {
        (async () => {
          let finalStroke: any = stroke;
          if (e2eeKey) {
            try {
              finalStroke = await encryptText(JSON.stringify(stroke), e2eeKey);
            } catch (err) {
              console.error("E2EE encryption failed for overlay stroke:", err);
            }
          }
          socket.emit('draw', { roomName, stroke: finalStroke });
        })();
      }
    };
    
    window.addEventListener('local-draw-stroke' as any, handleLocalDrawStroke);
    return () => {
      window.removeEventListener('local-draw-stroke' as any, handleLocalDrawStroke);
    };
  }, [socket, e2eeKey, roomName]);

  return (
    <div className="space-y-4 relative whiteboard-container">
      
      {/* ── LINK TO SHARE SCREEN CONTROL DASHBOARD ── */}
      <div 
        className="p-4 rounded-3xl border text-left relative overflow-hidden transition-all duration-300 shadow-xl"
        style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0.6) 100%)',
          borderColor: isLinkedToShareScreen ? 'rgba(209, 110, 71, 0.3)' : 'rgba(255, 255, 255, 0.05)',
          boxShadow: isLinkedToShareScreen ? '0 10px 30px rgba(209, 110, 71, 0.1)' : 'none'
        }}
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-2xl flex items-center justify-center transition-all ${
              isLinkedToShareScreen ? 'bg-[var(--nx-primary)]/10 text-[var(--nx-primary)] border border-[var(--nx-primary)]/20' : 'bg-white/5 text-slate-500'
            }`}>
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xs font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
                Link to Share Screen
                {isLinkedToShareScreen && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                )}
              </h3>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-normal">
                Calibrate and overlay digital whiteboard sketches on any live video feed in real-time.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsLinkedToShareScreen?.(!isLinkedToShareScreen)}
              className={`nx-btn text-2xs py-2 px-4 font-bold flex items-center gap-2 transition-all ${
                isLinkedToShareScreen 
                  ? 'nx-btn-primary shadow-lg shadow-[var(--nx-primary)]/20' 
                  : 'nx-btn-ghost hover:bg-white/5 border border-white/10 text-slate-300'
              }`}
            >
              <CloudLightning className="w-3.5 h-3.5" />
              {isLinkedToShareScreen ? 'Active (Click to Unlink)' : 'Enable Linking'}
            </button>
          </div>
        </div>

        {/* Expanded Controls when active */}
        {isLinkedToShareScreen && (
          <div className="mt-4 pt-3.5 border-t border-white/5 flex flex-wrap items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex flex-col gap-1 text-left">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                  Target Stream Source
                </label>
                <select
                  value={linkedStreamId || ''}
                  onChange={(e) => setLinkedStreamId?.(e.target.value || null)}
                  className="nx-input text-2xs bg-slate-950/80 border border-white/10 px-2 py-1 rounded-xl text-white font-semibold font-sans w-48 focus:outline-none focus:border-[var(--nx-primary)]/50"
                >
                  <option value="self">Local Webcam Feed</option>
                  {screenStream && (
                    <option value="screen">Active Screen Share</option>
                  )}
                </select>
              </div>

              <div className="flex flex-col gap-1 text-left">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                  whiteboard calibration
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsCalibrating?.(!isCalibrating)}
                    className={`text-[10px] font-bold px-3 py-1 rounded-xl border transition-all ${
                      isCalibrating
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300 animate-pulse'
                        : 'border-white/10 bg-slate-950/40 text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    {isCalibrating ? '✓ Finish Calibration' : '⚙ Calibrate Corners'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCalibrationPoints?.([
                        { x: 10, y: 10 },
                        { x: 90, y: 10 },
                        { x: 90, y: 90 },
                        { x: 10, y: 90 }
                      ]);
                      showToast("Calibration reset to default.", "success");
                    }}
                    className="text-[10px] px-3 py-1 rounded-xl border border-white/5 text-slate-500 hover:text-slate-300 transition-all hover:bg-white/5"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>

            <div className="text-[9px] text-slate-500 font-mono flex items-center gap-1.5 bg-slate-950/40 px-3 py-1.5 rounded-xl border border-white/5">
              <Lock className="w-3 h-3 text-indigo-400 animate-pulse" />
              Coordinate Matrix: DLT 3x3 Homography Enabled
            </div>
          </div>
        )}
      </div>
      
      {/* Toast Alert Indicator */}
      {toastMessage && (
        <div className={`absolute top-2 left-1/2 -translate-x-1/2 z-[100] px-3.5 py-2 rounded-xl border text-2xs font-semibold backdrop-blur-xl flex items-center gap-2 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-200 ${
          toastMessage.type === 'success' 
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' 
            : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
        }`}>
          {toastMessage.type === 'success' ? <Check className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Modern High-Fidelity Tool Board */}
      <div className="flex flex-wrap items-center justify-between bg-slate-950/60 p-3 rounded-2xl border border-white/5 gap-3 shadow-xl backdrop-blur-md">
        
        {/* Draw Tools Selection */}
        <div className="flex flex-wrap items-center gap-3">
          {e2eeKey && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-mono font-semibold shadow-sm animate-pulse">
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              <span>AES-256 E2EE Active</span>
            </div>
          )}
          <div className="flex bg-slate-900/60 p-1 rounded-xl border border-white/5 flex-wrap gap-0.5">
            <button 
              type="button"
              onClick={() => setTool('pen')}
              className={`p-2 rounded-lg transition-all duration-200 ${
                tool === 'pen' 
                  ? 'bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-600/20' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
              title="Interactive Pen Tool"
            >
              <PenTool className="w-4 h-4" />
            </button>
            
            <button 
              type="button"
              onClick={() => setTool('eraser')}
              className={`p-2 rounded-lg transition-all duration-200 ${
                tool === 'eraser' 
                  ? 'bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-600/20' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
              title="Eraser Tool"
            >
              <Eraser className="w-4 h-4" />
            </button>

            <button 
              type="button"
              onClick={() => setTool('text')}
              className={`p-2 rounded-lg transition-all duration-200 ${
                tool === 'text' 
                  ? 'bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-600/20' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
              title="Text Annotation Tool"
            >
              <Type className="w-4 h-4" />
            </button>

            <button 
              type="button"
              onClick={() => setTool('rectangle')}
              className={`p-2 rounded-lg transition-all duration-200 ${
                tool === 'rectangle' 
                  ? 'bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-600/20' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
              title="Rectangle Tool"
            >
              <Square className="w-4 h-4" />
            </button>

            <button 
              type="button"
              onClick={() => setTool('circle')}
              className={`p-2 rounded-lg transition-all duration-200 ${
                tool === 'circle' 
                  ? 'bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-600/20' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
              title="Circle Tool"
            >
              <Circle className="w-4 h-4" />
            </button>

            <button 
              type="button"
              onClick={() => setTool('line')}
              className={`p-2 rounded-lg transition-all duration-200 ${
                tool === 'line' 
                  ? 'bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-600/20' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
              title="Line Tool"
            >
              <Minus className="w-4 h-4" />
            </button>

            <button 
              type="button"
              onClick={() => setTool('arrow')}
              className={`p-2 rounded-lg transition-all duration-200 ${
                tool === 'arrow' 
                  ? 'bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-600/20' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
              title="Arrow Tool"
            >
              <ArrowRight className="w-4 h-4" />
            </button>

            <button 
              type="button"
              onClick={() => setTool('image')}
              className={`p-2 rounded-lg transition-all duration-200 ${
                tool === 'image' 
                  ? 'bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-600/20' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
              title="Image Annotation Tool"
            >
              <Image className="w-4 h-4" />
            </button>

            <button 
              type="button"
              onClick={() => setTool('laser')}
              className={`p-2 rounded-lg transition-all duration-200 ${
                tool === 'laser' 
                  ? 'bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-600/20' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
              title="Real-Time Presentation Laser Pointer"
            >
              <MousePointer className="w-4 h-4 text-rose-400 hover:scale-110 transition-transform duration-200" />
            </button>
          </div>

          <div className="h-6 w-px bg-white/10" />

          {/* Color Palette selectors */}
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-900/40 px-2 py-1.5 rounded-xl border border-white/5">
            <Palette className="w-3.5 h-3.5 text-slate-500 mr-1" />
            {['#6366f1', '#dcb16b', '#10b981', '#ffffff', '#eab308'].map(c => (
              <button 
                type="button"
                key={c}
                onClick={() => { setColor(c); }}
                className="w-4 h-4 rounded-full border transition-all duration-200 hover:scale-125 focus:outline-none flex items-center justify-center relative group" 
                style={{ backgroundColor: c, borderColor: 'rgba(255,255,255,0.15)' }} 
              >
                {color === c && (tool === 'pen' || tool === 'text') && (
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-950 absolute" />
                )}
                {/* Tooltip */}
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-1.5 py-0.5 rounded text-[8px] bg-slate-950 border border-white/10 text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                  {c}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="h-6 w-px bg-white/10" />

        {/* Global canvas actions */}
        <div className="flex flex-wrap items-center gap-1">
          
          <div className="flex gap-0.5 bg-slate-900/60 p-1 rounded-xl border border-white/5">
            <button 
              type="button"
              onClick={triggerUndo} 
              disabled={history.length === 0}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-200 disabled:opacity-30 hover:bg-white/5 transition-colors"
              title="Undo Action"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            
            <button 
              type="button"
              onClick={triggerRedo} 
              disabled={redoStack.length === 0}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-200 disabled:opacity-30 hover:bg-white/5 transition-colors"
              title="Redo Action"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex gap-1 pl-1">
            <button 
              type="button"
              onClick={exportBoard}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-white/5 transition-all duration-200"
              title="Export Canvas to PNG"
            >
              <Download className="w-4 h-4" />
            </button>

            {/* Cloud Storage Operations */}
            <button 
              type="button"
              onClick={cloudSaveBoard}
              disabled={isSavingCloud}
              className={`p-2 rounded-xl border transition-all duration-200 ${
                isSavingCloud 
                  ? 'border-indigo-500/30 text-indigo-400 bg-indigo-500/5 animate-pulse' 
                  : 'border-indigo-500/10 text-indigo-400 hover:text-indigo-200 hover:bg-indigo-500/10 hover:border-indigo-500/35'
              }`}
              title="Save snapshot to Supabase Cloud"
            >
              <UploadCloud className="w-4 h-4" />
            </button>

            <button 
              type="button"
              onClick={() => { fetchCloudSnapshots(); setShowSnapshotsList(prev => !prev); }}
              className={`p-2 rounded-xl border transition-all duration-200 ${
                showSnapshotsList 
                  ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-md shadow-indigo-500/15' 
                  : 'border-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
              title="Load saved snapshots"
            >
              <FolderOpen className="w-4 h-4" />
            </button>

            <button 
              type="button"
              onClick={clearBoard}
              className="p-2 rounded-xl border border-rose-500/10 text-rose-400 hover:text-rose-200 hover:bg-rose-500/10 hover:border-rose-500/30 transition-all duration-200"
              title="Clear Canvas Board"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

        </div>
      </div>

      {/* Cloud Snapshots Shelf with Soft Animation */}
      {showSnapshotsList && (
        <div className="bg-slate-950/90 border border-white/10 p-4 rounded-2xl shadow-2xl space-y-3 relative overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300 z-20 max-h-[220px] overflow-y-auto">
          
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />

          <div className="flex justify-between items-center pb-2 border-b border-white/5">
            <div className="flex items-center gap-1.5">
              <CloudLightning className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-[10px] uppercase tracking-wider text-slate-300 font-bold font-display">
                Cloud Snapshot Registry
              </span>
            </div>
            <button 
              type="button"
              onClick={fetchCloudSnapshots} 
              className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/5 transition"
              title="Refresh Snapshots"
            >
              <RefreshCw className={`w-3 h-3 ${isLoadingCloud ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {isLoadingCloud ? (
            <div className="flex flex-col items-center justify-center py-6 space-y-2">
              <span className="h-5 w-5 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin" />
              <span className="text-[10px] text-slate-500 font-mono">Syncing cloud drawings...</span>
            </div>
          ) : cloudSnapshots.length === 0 ? (
            <div className="text-center py-6 text-[10px] text-slate-500 italic bg-white/1 rounded-xl border border-white/5">
              No cloud snapshots archived for this room yet. Click Cloud Save to make one!
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {cloudSnapshots.map(s => (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => { loadWhiteboardFromUrl(s.url); setShowSnapshotsList(false); }}
                  className="flex items-center space-x-3 p-2 rounded-xl border border-white/5 bg-slate-900/40 hover:bg-indigo-600/5 hover:border-indigo-500/30 text-left transition-all duration-200 group"
                >
                  <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-slate-950 border border-white/10 flex-shrink-0">
                    <img 
                      src={s.url} 
                      alt="drawing snapshot" 
                      className="w-full h-full object-cover transition duration-300 group-hover:scale-110" 
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-indigo-950/20 group-hover:bg-transparent transition duration-200" />
                  </div>
                  
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="text-[9px] text-slate-200 font-bold truncate flex items-center gap-1">
                      <Sparkles className="w-2.5 h-2.5 text-indigo-400 group-hover:animate-bounce" />
                      <span>By {s.saved_by}</span>
                    </div>
                    <div className="text-[8px] text-slate-500 truncate font-mono">
                      {new Date(s.created_at).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Text Tool Settings Drawer */}
      {tool === 'text' && (
        <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-white/5 flex flex-wrap items-center gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Annotation Text:</span>
          <input 
            type="text" 
            value={annotationText} 
            onChange={e => setAnnotationText(e.target.value)} 
            placeholder="Type text here, then click on the canvas to place it..."
            className="flex-1 min-w-[200px] bg-slate-900/80 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/50" 
          />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400">Size:</span>
            <input 
              type="number" 
              value={fontSize} 
              onChange={e => setFontSize(Math.max(8, Math.min(64, parseInt(e.target.value) || 12)))} 
              className="w-14 bg-slate-900/80 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white text-center focus:outline-none" 
            />
            <span className="text-2xs text-slate-500">px</span>
          </div>
        </div>
      )}

      {/* Image Tool Settings Drawer */}
      {tool === 'image' && (
        <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-white/5 flex flex-wrap items-center gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Image Source:</span>
          
          {/* Online URL Paste Input */}
          <input 
            type="text" 
            value={imageUrl} 
            onChange={e => setImageUrl(e.target.value)} 
            placeholder="Paste image URL from internet here..."
            className="flex-1 min-w-[200px] bg-slate-900/80 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/50" 
          />

          <span className="text-[10px] text-slate-500 font-bold">OR</span>

          {/* Local Upload Button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="nx-btn nx-btn-ghost text-2xs py-1.5 px-3 flex items-center gap-1.5 animate-pulse"
          >
            <UploadCloud className="w-3.5 h-3.5" /> Upload File
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageUpload}
            accept="image/*"
            className="hidden"
          />

          {/* Live High-Fidelity Validation Image Preview */}
          {imageUrl.trim() && (
            <div className={`relative w-9 h-9 rounded-xl overflow-hidden border bg-slate-900/60 flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
              isImageValid === true ? 'border-emerald-500/40 shadow-lg shadow-emerald-500/10' :
              isImageValid === false ? 'border-rose-500/40 shadow-lg shadow-rose-500/10' :
              'border-white/10'
            }`} title={isImageValid === true ? "Image Valid (Click canvas to place)" : isImageValid === false ? "Broken Image URL" : "Verifying Image..."}>
              {isImageLoading ? (
                <span className="h-3 w-3 rounded-full border border-indigo-500/30 border-t-indigo-400 animate-spin" />
              ) : isImageValid === true ? (
                <img src={imageUrl} alt="preview" className="w-full h-full object-cover" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
              )}
            </div>
          )}

          {/* Size Controllers */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400">Width:</span>
            <input 
              type="number" 
              value={imageWidth} 
              onChange={e => setImageWidth(Math.max(20, Math.min(800, parseInt(e.target.value) || 100)))} 
              className="w-14 bg-slate-900/80 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white text-center focus:outline-none" 
            />
            <span className="text-[10px] text-slate-400 ml-1">Height:</span>
            <input 
              type="number" 
              value={imageHeight} 
              onChange={e => setImageHeight(Math.max(20, Math.min(800, parseInt(e.target.value) || 100)))} 
              className="w-14 bg-slate-900/80 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white text-center focus:outline-none" 
            />
            <span className="text-2xs text-slate-500">px</span>
          </div>
        </div>
      )}

      {/* Shape Tool Settings Drawer */}
      {(tool === 'rectangle' || tool === 'circle' || tool === 'line' || tool === 'arrow') && (
        <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-white/5 flex flex-wrap items-center gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Shape Options:</span>
          {(tool === 'rectangle' || tool === 'circle') && (
            <button
              type="button"
              onClick={() => setFillShapes(!fillShapes)}
              className={`nx-btn text-2xs py-1.5 px-3 flex items-center gap-1.5 transition-all duration-200 ${
                fillShapes 
                  ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-md shadow-indigo-500/15' 
                  : 'bg-slate-900/80 border-white/10 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{fillShapes ? 'Filled Shape' : 'Outline Only'}</span>
            </button>
          )}
          <span className="text-2xs text-slate-500 font-mono text-slate-400">
            Click and drag on the canvas to draw a {tool}.
          </span>
        </div>
      )}

      {/* Laser Tool Settings/Info Drawer */}
      {tool === 'laser' && (
        <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-white/5 flex flex-wrap items-center gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
          <span className="text-[10px] text-rose-400 font-bold uppercase tracking-wider flex items-center gap-1.5 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-rose-500 ring-4 ring-rose-500/30" />
            Laser Pointer Mode:
          </span>
          <span className="text-2xs text-slate-400 font-mono">
            Hover to present with a glowing cursor. Click and drag to create real-time neon fading trails.
          </span>
        </div>
      )}

      {/* Main Drawing Canvas Board with Cyberpunk Shell Frame */}
      <div className="border border-white/5 rounded-3xl overflow-hidden bg-[#060a18] shadow-2xl relative group">
        
        {/* Glow corner decorations */}
        <div className="absolute -top-12 -right-12 w-24 h-24 bg-indigo-500/5 rounded-full blur-xl pointer-events-none group-hover:bg-indigo-500/10 transition-all duration-300" />
        <div className="absolute -bottom-12 -left-12 w-24 h-24 bg-amber-500/5 rounded-full blur-xl pointer-events-none group-hover:bg-amber-500/10 transition-all duration-300" />

        {/* Dynamic canvas node */}
        <canvas 
          ref={canvasRef}
          width="1000" // Aligned coordinate resolution to exactly match perspective mapping
          height="640"
          onMouseDown={handleStartDraw}
          onMouseMove={handleDraw}
          onMouseUp={handleStopDraw}
          onMouseLeave={handleStopDraw}
          className="block w-full cursor-crosshair relative z-10"
        />

        {/* Dynamic High-Performance Overlay Canvas for Laser Pointer Trails */}
        <canvas 
          ref={overlayCanvasRef}
          width="1000"
          height="640"
          className="absolute top-0 left-0 w-full h-full pointer-events-none z-20"
        />

        {/* Real-time Collaborative Cursors Layer */}
        <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
          {localOverlayHover && (
            <div 
              className="absolute pointer-events-none flex flex-col items-center justify-center transition-all duration-75 ease-out z-40"
              style={{
                left: `${(localOverlayHover.x / 1000) * 100}%`,
                top: `${(localOverlayHover.y / 640) * 100}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div className="w-5 h-5 rounded-full border-2 border-[var(--nx-primary)] bg-[var(--nx-primary)]/20 animate-pulse flex items-center justify-center shadow-[0_0_10px_var(--nx-primary)]">
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--nx-primary)] shadow-[0_0_4px_var(--nx-primary)]" />
              </div>
              <div className="mt-1 px-1.5 py-0.5 rounded bg-slate-950/80 border border-[var(--nx-primary)]/40 text-[7px] text-white font-mono uppercase tracking-wider font-bold">
                Drawing Spot
              </div>
            </div>
          )}
          {Object.values(remoteCursors).map((cursor) => {
            if (!cursor.active) return null;
            
            // Calculate absolute position based on parent bounds using coordinate percentages
            const leftPercent = `${(cursor.x / 1000) * 100}%`;
            const topPercent = `${(cursor.y / 640) * 100}%`;

            return (
              <div
                key={cursor.socketId}
                className="absolute flex flex-col items-start transition-all duration-75 ease-out"
                style={{
                  left: leftPercent,
                  top: topPercent,
                  transform: 'translate(-2px, -2px)', // center alignment offset
                }}
              >
                {/* Visual Cursor Arrow / Glow indicator */}
                {cursor.isLaser ? (
                  // Custom gorgeous neon laser pointer ring (since dot is drawn in overlay canvas)
                  <div className="w-2.5 h-2.5 rounded-full bg-white ring-4 animate-ping" style={{ ringColor: cursor.color, '--tw-ring-color': cursor.color } as any} />
                ) : (
                  // Custom elegant cyberpunk mouse pointer SVG styled with the user's theme color
                  <svg
                    className="w-4 h-4 drop-shadow-[0_2px_5px_rgba(0,0,0,0.5)]"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M4.5 3V17.5L9.2 12.8L14.8 21L17.5 19.2L12 11.2L17.5 10.5L4.5 3Z"
                      fill={cursor.color}
                      stroke="white"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}

                {/* Elegant Glassmorphic Username Badge */}
                <div 
                  className="mt-1 px-2 py-0.5 rounded-md text-[8px] font-bold font-mono tracking-wide text-white border backdrop-blur-md shadow-md animate-in fade-in zoom-in-90 duration-200"
                  style={{ 
                    backgroundColor: `${cursor.color}25`, // transparent tint
                    borderColor: `${cursor.color}40` // semi-transparent border
                  }}
                >
                  {cursor.username}
                </div>
              </div>
            );
          })}
        </div>

        {/* Subtle coordinate overlay indicator */}
        <div className="absolute bottom-2 right-3 z-40 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-[8px] font-mono text-slate-500 uppercase tracking-widest">
          Active Room Plane • {roomName}
        </div>
      </div>
      
      {/* Footer details with Custom Premium Slider */}
      <div className="flex flex-wrap items-center justify-between text-[10px] text-slate-400 bg-slate-950/40 p-3 rounded-2xl border border-white/5 shadow-inner gap-2">
        <div className="flex items-center gap-1.5">
          <Sliders className="w-3.5 h-3.5 text-indigo-400" />
          <span className="font-semibold">Brush weight</span>
          <span className="font-mono bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 text-indigo-300">{brushSize}px</span>
        </div>
        
        <div className="flex items-center gap-2 flex-1 min-w-[120px] justify-end">
          <span className="text-[9px] text-slate-600 font-mono">Fine</span>
          <input 
            type="range" 
            min="2" 
            max="16" 
            value={brushSize} 
            onChange={(e) => setBrushSize(parseInt(e.target.value))}
            className="flex-1 min-w-[60px] accent-indigo-500"
          />
          <span className="text-[9px] text-slate-600 font-mono">Bold</span>
        </div>
      </div>

    </div>
  );
}
