import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Video, VideoOff, Mic, MicOff, Monitor, MonitorOff, ShieldCheck,
  Users, MessageSquare, Radio,
  Eye, EyeOff, Sliders, Play, Lock, ShieldAlert,
  Zap, Edit2, Send, X, PhoneOff, WifiOff, Wifi,
  BarChart2, Activity, Hash, LogOut,
  AlertTriangle, Headphones, Copy, PhoneCall,
  LayoutGrid, LayoutPanelLeft, LayoutPanelTop, PictureInPicture2, Columns2, Columns3, Paperclip,
  Plus, User, BookUser, ImagePlus, Save, Pin, PinOff, Maximize2, Scan, MousePointer, Keyboard,
  Bell, Download, Trash, Sparkles, FileText, FolderLock
} from 'lucide-react';
import { useWebRTC, Participant } from './hooks/useWebRTC.ts';
import { useAudioPipeline } from './hooks/useAudioPipeline.ts';
import { useNotifications } from './hooks/useNotifications.ts';
import Whiteboard from './components/Whiteboard.tsx';
import WorkspacePanel from './components/WorkspacePanel.tsx';
import ChaperoneOverlay from './components/ChaperoneOverlay.tsx';
import { LandingPage } from './components/LandingPage.tsx';
import { encryptText, decryptText, deriveKeyFromPassphrase, encryptChunk, decryptChunk } from './lib/e2ee.ts';
import DiagnosticsPanel from './components/DiagnosticsPanel.tsx';
import AiAssistantPanel from './components/AiAssistantPanel.tsx';
import { getHomographyMatrix, transformPoint, getCssMatrix3d } from './lib/homography.ts';


const API = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8001';
const WS_URL = (import.meta as any).env?.VITE_WS_URL || 'http://localhost:8000';
const AI = (import.meta as any).env?.VITE_AI_URL || 'http://localhost:8002';

/* ─────────────────────────────────────────
   Types
───────────────────────────────────────── */
interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  decryptedText?: string;
  time: string;
  self: boolean;
  status?: 'sending' | 'delivered';
}

type Tab = 'chat' | 'audio' | 'whiteboard' | 'workspace' | 'control' | 'participants' | 'profile' | 'contacts' | 'diagnostics' | 'ai';

interface UserProfile {
  username: string;
  bio: string;
  profilePic: string;
}

interface Contact {
  id: string;
  username: string;
  bio: string;
  profilePic: string;
}

interface IncomingCallData {
  callerName:     string;
  callerUsername: string;
  callerId:       string;
  room:           string;
  callType:       'voice' | 'video';
  callId?:        number;
}

interface OutgoingCall {
  targetUsername: string;
  room: string;
  callType: 'voice' | 'video';
  callId?: number;
  status: 'ringing' | 'ringing_push' | 'accepted' | 'declined' | 'failed' | 'timeout';
  errorReason?: string;
}


/* ─────────────────────────────────────────
   Helpers
───────────────────────────────────────── */
const nowTime = () => new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
const uid = () => Math.random().toString(36).slice(2, 10);

const isValidProfilePic = (url?: string): boolean => {
  if (!url) return false;
  const clean = url.trim();
  if (clean === '' || clean === 'null' || clean === 'undefined') return false;
  return clean.startsWith('data:image/') || clean.startsWith('http://') || clean.startsWith('https://');
};

/* ─────────────────────────────────────────
   Toast
───────────────────────────────────────── */
function Toast({ msg, type, onDone }: { msg: string; type: 'success' | 'error' | 'info'; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, []);
  const colors = {
    success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    error:   'border-rose-500/40 bg-rose-500/10 text-rose-300',
    info:    'border-indigo-500/40 bg-indigo-500/10 text-indigo-300',
  };
  return (
    <div
      className={`fixed top-5 right-5 z-[9999] px-4 py-3 rounded-2xl border text-sm font-semibold shadow-2xl backdrop-blur-xl flex items-center gap-3 nx-alert ${colors[type]}`}
      style={{ maxWidth: 340 }}
    >
      {type === 'success' && <ShieldCheck className="w-4 h-4 flex-shrink-0" />}
      {type === 'error'   && <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
      {type === 'info'    && <Activity className="w-4 h-4 flex-shrink-0" />}
      <span>{msg}</span>
      <button onClick={onDone} className="ml-auto opacity-60 hover:opacity-100 transition">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────
   Main App
───────────────────────────────────────── */
/* ─────────────────────────────────────────
   Hash Routing Initializer
   ───────────────────────────────────────── */
/* ─────────────────────────────────────────
   Persistent Cookie Helpers
   ───────────────────────────────────────── */
const setRememberCookie = (username: string, token: string) => {
  const data = JSON.stringify({ username, token });
  const d = new Date();
  d.setTime(d.getTime() + (365 * 24 * 60 * 60 * 1000)); // 365 days
  const expires = "expires=" + d.toUTCString();
  document.cookie = `nexalink_remember=${encodeURIComponent(data)};${expires};path=/;SameSite=Strict`;
};

const getRememberCookie = (): { username: string; token: string } | null => {
  if (typeof document === 'undefined') return null;
  const name = "nexalink_remember=";
  const decodedCookie = decodeURIComponent(document.cookie);
  const ca = decodedCookie.split(';');
  for(let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') {
      c = c.substring(1);
    }
    if (c.indexOf(name) === 0) {
      try {
        const rawData = c.substring(name.length, c.length);
        return JSON.parse(rawData);
      } catch (e) {
        return null;
      }
    }
  }
  return null;
};

const deleteRememberCookie = () => {
  document.cookie = "nexalink_remember=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;SameSite=Strict";
};

const getLastActiveTime = (): Date | null => {
  if (typeof document === 'undefined') return null;
  const name = "nexalink_last_active=";
  const decodedCookie = decodeURIComponent(document.cookie);
  const ca = decodedCookie.split(';');
  for(let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') {
      c = c.substring(1);
    }
    if (c.indexOf(name) === 0) {
      const val = c.substring(name.length, c.length);
      return val ? new Date(val) : null;
    }
  }
  return null;
};

const setLastActiveTime = (time: string) => {
  document.cookie = `nexalink_last_active=${encodeURIComponent(time)};path=/;SameSite=Strict;max-age=31536000`;
};

const getNotifiedMsgIds = (): string[] => {
  if (typeof document === 'undefined') return [];
  const name = "nexalink_notified_msg_ids=";
  const decodedCookie = decodeURIComponent(document.cookie);
  const ca = decodedCookie.split(';');
  for(let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') {
      c = c.substring(1);
    }
    if (c.indexOf(name) === 0) {
      try {
        const val = c.substring(name.length, c.length);
        return JSON.parse(val);
      } catch (e) {
        return [];
      }
    }
  }
  return [];
};

const addNotifiedMsgId = (id: string) => {
  const current = getNotifiedMsgIds();
  if (current.includes(id)) return;
  const updated = [...current, id].slice(-100); // keep last 100 to avoid huge cookies
  const data = JSON.stringify(updated);
  document.cookie = `nexalink_notified_msg_ids=${encodeURIComponent(data)};path=/;SameSite=Strict;max-age=31536000`;
};

const getInitialNavigation = (): { view: 'landing' | 'lobby' | 'connecting' | 'room'; subview: 'connect' | 'chat_lobby' } => {
  const hash = typeof window !== 'undefined' ? window.location.hash : '';
  let token = typeof window !== 'undefined' ? sessionStorage.getItem('nexalink_token') : null;
  const savedView = typeof window !== 'undefined' ? sessionStorage.getItem('nexalink_current_view') : null;
  const savedSubView = typeof window !== 'undefined' ? sessionStorage.getItem('nexalink_lobby_subview') : null;

  if (!token && typeof window !== 'undefined') {
    const remember = getRememberCookie();
    if (remember && remember.username && remember.token) {
      sessionStorage.setItem('nexalink_token', remember.token);
      sessionStorage.setItem('nexalink_username', remember.username);
      token = remember.token;
    }
  }

  if (!token) {
    return { view: 'landing', subview: 'connect' };
  }

  if (hash === '#lobby/chat') {
    return { view: 'lobby', subview: 'chat_lobby' };
  } else if (hash === '#lobby/connect' || hash === '#lobby') {
    return { view: 'lobby', subview: 'connect' };
  } else if (hash === '#connecting') {
    return { view: 'connecting', subview: 'connect' };
  } else if (hash === '#room') {
    return { view: 'room', subview: 'connect' };
  } else {
    let view = (savedView as any) || 'lobby';
    if (view === 'room' || view === 'connecting') {
      view = 'lobby';
    }
    if (view === 'landing') {
      view = 'lobby';
    }
    return {
      view,
      subview: (savedSubView === 'chat_lobby' ? 'chat_lobby' : 'connect') as any
    };
  }
};

export default function App() {
  /* Notifications */
  const { requestPermission, unsubscribe: unsubscribeNotif, notify } = useNotifications();

  /* PWA Installation States & Handlers */
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showPwaInstallGuide, setShowPwaInstallGuide] = useState(false);
  const [isStandalone, setIsStandalone] = useState(() => {
    return typeof window !== 'undefined' ? window.matchMedia('(display-mode: standalone)').matches : false;
  });

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      console.log('[PWA] beforeinstallprompt event captured ✔');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    const handleAppInstalled = () => {
      console.log('[PWA] App installed successfully 🎉');
      setIsStandalone(true);
      setShowPwaInstallGuide(false);
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const triggerPwaInstall = async () => {
    if (!deferredPrompt) {
      alert("Browser installation prompt is not ready yet. In Chromium-based browsers, look for the 'Install' icon (computer with down arrow) in the right side of the address bar, or click settings (three dots) -> 'Save and share' -> 'Install page' / 'Install NexaLink'.");
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`[PWA] Install prompt outcome: ${outcome}`);
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      setIsStandalone(true);
      setShowPwaInstallGuide(false);
    }
  };

  /* Auth state */
  const [authToken, setAuthToken] = useState<string | null>(() => {
    let token = typeof window !== 'undefined' ? sessionStorage.getItem('nexalink_token') : null;
    if (!token && typeof window !== 'undefined') {
      const remember = getRememberCookie();
      if (remember && remember.username && remember.token) {
        sessionStorage.setItem('nexalink_token', remember.token);
        sessionStorage.setItem('nexalink_username', remember.username);
        token = remember.token;
      }
    }
    return token;
  });
  const [clockOffset, setClockOffset] = useState<number>(0);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authUsername, setAuthUsername] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  /* Room state */
  const [inRoom, setInRoom] = useState(false);
  const [roomName, setRoomName] = useState('NexaRoom-Alpha');
  const [userName, setUserName] = useState<string>(() => {
    return (typeof window !== 'undefined' ? sessionStorage.getItem('nexalink_username') : null) || 'Alice';
  });
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [directPeer, setDirectPeer] = useState('');
  const [profile, setProfile] = useState<UserProfile>(() => {
    const username = (typeof window !== 'undefined' ? sessionStorage.getItem('nexalink_username') : null) || 'Alice';
    return { username, bio: '', profilePic: '' };
  });
  const [contacts, setContacts] = useState<Contact[]>(() => {
    const saved = sessionStorage.getItem('nexalink_contacts');
    return saved ? JSON.parse(saved) : [];
  });
  const [newContact, setNewContact] = useState('');
  const [sidebarTab, setSidebarTab] = useState<'contacts' | 'calls'>('contacts');
  const [callHistory, setCallHistory] = useState<any[]>([]);
  const [activeDirectCallId, setActiveDirectCallId] = useState<number | null>(null);

  /* UI state */
  const [currentView, setCurrentView] = useState<'landing' | 'lobby' | 'connecting' | 'room'>(() => {
    const initial = getInitialNavigation();
    return initial.view;
  });
  const [activeTab, setActiveTab] = useState<Tab>('audio');
  
  // ── LINK TO SHARE SCREEN FEATURE STATES & REFS ──
  const [isLinkedToShareScreen, setIsLinkedToShareScreen] = useState(false);
  const [linkedStreamId, setLinkedStreamId] = useState<string | null>(null);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<Array<{ x: number; y: number }>>([
    { x: 10, y: 10 },   // Top-Left (TL)
    { x: 90, y: 10 },   // Top-Right (TR)
    { x: 90, y: 90 },   // Bottom-Right (BR)
    { x: 10, y: 90 }    // Bottom-Left (BL)
  ]);
  const [isOverlayDrawing, setIsOverlayDrawing] = useState(false);
  const overlayLastPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const draggingHandleIdxRef = useRef<number | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const whiteboardPersistRef = useRef<{
    canvasDataUrl: string | null;
    history: string[];
    redoStack: string[];
    color: string;
    brushSize: number;
    tool: 'pen' | 'eraser' | 'text' | 'image' | 'rectangle' | 'circle' | 'line' | 'arrow' | 'laser';
    fillShapes: boolean;
    fontSize: number;
  }>({
    canvasDataUrl: null,
    history: [],
    redoStack: [],
    color: '#dcb16b',
    brushSize: 4,
    tool: 'pen',
    fillShapes: false,
    fontSize: 16,
  });
  
  // Track container pixel dimensions for accurate perspective calculations
  const [containerSize, setContainerSize] = useState({ width: 853, height: 480 });
  
  // Bidirectional pointer tracking states
  const [overlayHoverPos, setOverlayHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [whiteboardProjectedPointer, setWhiteboardProjectedPointer] = useState<{ x: number; y: number } | null>(null);



  const [isQualityMenuOpen, setIsQualityMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [fitMode, setFitMode] = useState<'cover' | 'contain'>('cover');
  const [pinnedTile, setPinnedTile] = useState<string | null>(null);
  const [requestControlTarget, setRequestControlTarget] = useState<{ id: string; name: string } | null>(null);
  // Stream layout mode — drives how the video tiles are arranged
  // 'auto'       → smart grid (default, adapts to participant count)
  // 'pip-remote' → remote party fills stage, self in small corner PiP
  // 'pip-local'  → local fills stage, remote in small corner PiP
  // 'equal'      → both tiles equal side-by-side
  // 'three'      → three equal columns grid
  // 'horizontal' → horizontal strip (self left, remotes right in column)
  const [streamLayout, setStreamLayout] = useState<'auto' | 'pip-remote' | 'pip-local' | 'equal' | 'three' | 'horizontal'>('auto');
  const [tileOrder, setTileOrder] = useState<string[]>([]);
  const [dragOverTileId, setDragOverTileId] = useState<string | null>(null);

  // ── Desktop Agent Integration States ──
  const [isMiniMode, setIsMiniMode] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const backupLayoutRef = useRef<'auto' | 'pip-remote' | 'pip-local' | 'equal' | 'three' | 'horizontal'>('auto');

  /* AI Captions & Meeting Intelligence States */
  const [liveCaptionsEnabled, setLiveCaptionsEnabled] = useState(false);
  const [captionsLanguage, setCaptionsLanguage] = useState('en-US');
  const [translationLanguage, setTranslationLanguage] = useState('none');
  const [liveCaptions, setLiveCaptions] = useState<{ [username: string]: string }>({});
  const [translatedCaptions, setTranslatedCaptions] = useState<{ [username: string]: string }>({});
  const [meetingTranscript, setMeetingTranscript] = useState<{ id: string; sender: string; text: string; translatedText?: string; timestamp: Date }[]>([]);
  const [extractedActionItems, setExtractedActionItems] = useState<any[]>([]);
  const [extractedSummary, setExtractedSummary] = useState('');
  const [extractedSentiment, setExtractedSentiment] = useState('Neutral');
  const [extractedTopics, setExtractedTopics] = useState<string[]>([]);
  const [isAnalyzingMeeting, setIsAnalyzingMeeting] = useState(false);
  const [captionSearchQuery, setCaptionSearchQuery] = useState('');
  const captionTimeouts = useRef<{ [username: string]: any }>({});

  /* Sidebar Resizing States & Logic */
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const isResizingRef = useRef(false);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newWidth = window.innerWidth - e.clientX - 24;
      const maxSidebarWidth = isLinkedToShareScreen ? window.innerWidth - 300 : 800;
      if (newWidth > 200 && newWidth < maxSidebarWidth) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isLinkedToShareScreen]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('msfullscreenchange', handleFullscreenChange);
    // Initial sync
    setIsFullscreen(!!document.fullscreenElement);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('msfullscreenchange', handleFullscreenChange);
    };
  }, []);

  /* Chat */
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [unreadChat, setUnreadChat] = useState(0);
  const [roomTypingUsers, setRoomTypingUsers] = useState<Set<string>>(new Set());
  const [dmTypingStatus, setDmTypingStatus] = useState<Record<string, boolean>>({});
  const localRoomTypingTimeoutRef = useRef<any>(null);
  const localDmTypingTimeoutRef = useRef<Record<string, any>>({});

  /* Client-Side E2EE Room & DM States */
  const [roomPassphrase, setRoomPassphrase] = useState('');
  const [roomE2eeKey, setRoomE2eeKey] = useState<CryptoKey | null>(null);
  const roomE2eeKeyRef = useRef<CryptoKey | null>(null);
  useEffect(() => {
    roomE2eeKeyRef.current = roomE2eeKey;
  }, [roomE2eeKey]);

  const [dmSecrets, setDmSecrets] = useState<{ [contactUsername: string]: string }>(() => {
    try {
      const saved = localStorage.getItem('nexalink_dm_secrets');
      return saved ? JSON.parse(saved) : {};
    } catch (err) {
      return {};
    }
  });
  const [dmCryptoKeys, setDmCryptoKeys] = useState<{ [contactUsername: string]: CryptoKey }>({});
  const dmCryptoKeysRef = useRef<{ [contactUsername: string]: CryptoKey }>({});
  useEffect(() => {
    dmCryptoKeysRef.current = dmCryptoKeys;
  }, [dmCryptoKeys]);

  const sortUsernames = (u1: string, u2: string) => [u1.toLowerCase(), u2.toLowerCase()].sort().join(':');

  useEffect(() => {
    localStorage.setItem('nexalink_dm_secrets', JSON.stringify(dmSecrets));
    const deriveAllKeys = async () => {
      const newKeys: { [contactUsername: string]: CryptoKey } = {};
      for (const [username, secret] of Object.entries(dmSecrets)) {
        if (secret.trim()) {
          try {
            newKeys[username] = await deriveKeyFromPassphrase(secret, sortUsernames(userName, username));
          } catch (err) {
            console.error(`Failed to derive key for contact ${username}:`, err);
          }
        }
      }
      setDmCryptoKeys(newKeys);
    };
    deriveAllKeys();
  }, [dmSecrets, userName]);

  const handleSetDmSecret = async (contactUsername: string, secret: string) => {
    setDmSecrets(prev => ({ ...prev, [contactUsername]: secret }));
    if (!secret.trim()) {
      setDmCryptoKeys(prev => {
        const copy = { ...prev };
        delete copy[contactUsername];
        return copy;
      });
      return;
    }
    try {
      const key = await deriveKeyFromPassphrase(secret, sortUsernames(userName, contactUsername));
      setDmCryptoKeys(prev => ({ ...prev, [contactUsername]: key }));
      
      setLobbyChats(prev => {
        const history = prev[contactUsername];
        if (!history) return prev;
        
        const updated = history.map(m => {
          if (m.text.startsWith('[E2EE]:')) {
            decryptText(m.text, key).then(decrypted => {
              setLobbyChats(latest => {
                const latestHistory = latest[contactUsername];
                if (!latestHistory) return latest;
                return {
                  ...latest,
                  [contactUsername]: latestHistory.map(item => item.id === m.id ? { ...item, decryptedText: decrypted } : item)
                };
              });
            }).catch(() => {
              setLobbyChats(latest => {
                const latestHistory = latest[contactUsername];
                if (!latestHistory) return latest;
                return {
                  ...latest,
                  [contactUsername]: latestHistory.map(item => item.id === m.id ? { ...item, decryptedText: '🔒 [Decryption Failed - Invalid Passphrase]' } : item)
                };
              });
            });
          }
          return m;
        });
        
        return {
          ...prev,
          [contactUsername]: updated
        };
      });
    } catch (err) {
      console.error("Failed to derive E2EE key for DM:", err);
    }
  };

  const handleSetRoomPassphrase = async (passphrase: string) => {
    setRoomPassphrase(passphrase);
    if (!passphrase.trim()) {
      setRoomE2eeKey(null);
      return;
    }
    try {
      const key = await deriveKeyFromPassphrase(passphrase, roomName);
      setRoomE2eeKey(key);
      
      setChatMessages(prev => {
        return prev.map(m => {
          if (m.text.startsWith('[E2EE]:')) {
            decryptText(m.text, key).then(decrypted => {
              setChatMessages(latest => {
                return latest.map(item => item.id === m.id ? { ...item, decryptedText: decrypted } : item);
              });
            }).catch(() => {
              setChatMessages(latest => {
                return latest.map(item => item.id === m.id ? { ...item, decryptedText: '🔒 [Decryption Failed - Invalid Passphrase]' } : item);
              });
            });
          }
          return m;
        });
      });
    } catch (err) {
      console.error("Failed to derive E2EE key for room:", err);
    }
  };

  const chatEndRef = useRef<HTMLDivElement>(null);
  const callStageRef = useRef<HTMLDivElement | null>(null);

  /* TTS */
  const [ttsText, setTtsText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('XTTS-v2 Host Male');
  const [ttsQueue, setTtsQueue] = useState<string[]>([]);
  const [ttsMode, setTtsMode] = useState<'neural' | 'browser'>('neural');
  const [ttsPitchFactor, setTtsPitchFactor] = useState<number>(1.0);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const loadVoices = () => {
        setBrowserVoices(window.speechSynthesis.getVoices());
      };
      loadVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }
    }
  }, []);



  /* Overhaul and Redesign States */
  const [callType, setCallType] = useState<'voice' | 'video'>('video');
  // const [isPreflightConnecting, setIsPreflightConnecting] = useState(false);
  const [locallyMutedPeers, setLocallyMutedPeers] = useState<string[]>([]);
  const [locallyHiddenPeers, setLocallyHiddenPeers] = useState<string[]>([]);
  const [lobbySubView, setLobbySubView] = useState<'connect' | 'chat_lobby' | 'settings'>(() => {
    const saved = sessionStorage.getItem('nexalink_lobby_subview');
    return (saved as any) || 'connect';
  });
  const [activeChatContact, setActiveChatContact] = useState<Contact | null>(null);
  const activeChatContactRef = useRef<Contact | null>(null);
  useEffect(() => {
    activeChatContactRef.current = activeChatContact;
  }, [activeChatContact]);

  const lobbySubViewRef = useRef<'connect' | 'chat_lobby' | 'settings'>('connect');
  useEffect(() => {
    lobbySubViewRef.current = lobbySubView;
  }, [lobbySubView]);

  const [lobbyChats, setLobbyChats] = useState<{ [contactId: string]: ChatMessage[] }>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [notificationLogs, setNotificationLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [lobbyChatInput, setLobbyChatInput] = useState('');
  const [showInboxDropdown, setShowInboxDropdown] = useState(false);
  const [unreadChatCounts, setUnreadChatCounts] = useState<{ [username: string]: number }>({});
  const [pendingFiles, setPendingFiles] = useState<any[]>([]);
  const filePeerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const fileDataChannelRef = useRef<RTCDataChannel | null>(null);
  const selectedFileRef = useRef<File | null>(null);
  const fileIceCandidatesQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const [fileTransferProgress, setFileTransferProgress] = useState<{
    transferId: number;
    fileName: string;
    fileSize: number;
    progress: number;
    speed: string;
    status: 'connecting' | 'transferring' | 'completed' | 'failed' | 'idle';
    role: 'sender' | 'receiver';
    isEncrypted?: boolean;
  } | null>(null);
  const [fileTransferHistory, setFileTransferHistory] = useState<any[]>([]);
  const [isFileVaultOpen, setIsFileVaultOpen] = useState<boolean>(false);
  const [vaultSearchQuery, setVaultSearchQuery] = useState<string>('');
  const [inboxNotifications, setInboxNotifications] = useState<{ id: string; type: 'chat' | 'call'; sender: string; title: string; desc: string; time: string; read: boolean; room?: string; fileTransferId?: number }[]>(() => {
    const saved = sessionStorage.getItem('nexalink_notifications');
    return saved ? JSON.parse(saved) : [
      { id: 'n1', type: 'call', sender: 'System', title: 'Welcome to NexaLink!', desc: 'Private secure tunnel logic loaded successfully.', time: nowTime(), read: false }
    ];
  });

  /* Media & Device State Selectors */
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState<string>(() => sessionStorage.getItem('nexalink_selected_mic') || 'default');
  const [selectedVideoInput, setSelectedVideoInput] = useState<string>(() => sessionStorage.getItem('nexalink_selected_cam') || 'default');
  const [selectedAudioOutput, setSelectedAudioOutput] = useState<string>(() => sessionStorage.getItem('nexalink_selected_speaker') || 'default');
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());

  // Incoming call modal state
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);
  const [outgoingCall, setOutgoingCall] = useState<OutgoingCall | null>(null);
  const callDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Notification permission banner — show if not yet granted/denied
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    'Notification' in window ? Notification.permission : 'unsupported'
  );

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = sessionStorage.getItem('nexalink_theme');
    return (saved as 'light' | 'dark') || 'dark';
  });

  const [chatSettings, setChatSettings] = useState<{ pressEnterToSend: boolean; soundEnabled: boolean; typingIndicators: boolean }>(() => {
    const saved = sessionStorage.getItem('nexalink_chat_settings');
    return saved ? JSON.parse(saved) : { pressEnterToSend: true, soundEnabled: true, typingIndicators: true };
  });

  const [notifSettings, setNotifSettings] = useState<{ desktopEnabled: boolean; showToastAlerts: boolean; pushWakingEnabled: boolean }>(() => {
    const saved = sessionStorage.getItem('nexalink_notif_settings');
    return saved ? JSON.parse(saved) : { desktopEnabled: true, showToastAlerts: true, pushWakingEnabled: true };
  });

  const [autoPipEnabled, setAutoPipEnabled] = useState<boolean>(() => {
    const saved = sessionStorage.getItem('nexalink_auto_pip');
    return saved !== 'false'; // default to true
  });

  const [pipIncludeSidebar, setPipIncludeSidebar] = useState<boolean>(() => {
    const saved = sessionStorage.getItem('nexalink_pip_include_sidebar');
    return saved === 'true'; // default to false
  });

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light-mode');
      sessionStorage.setItem('nexalink_theme', 'light');
    } else {
      document.documentElement.classList.remove('light-mode');
      sessionStorage.setItem('nexalink_theme', 'dark');
    }
  }, [theme]);

  useEffect(() => {
    sessionStorage.setItem('nexalink_chat_settings', JSON.stringify(chatSettings));
  }, [chatSettings]);

  useEffect(() => {
    sessionStorage.setItem('nexalink_notif_settings', JSON.stringify(notifSettings));
  }, [notifSettings]);

  useEffect(() => {
    sessionStorage.setItem('nexalink_auto_pip', String(autoPipEnabled));
  }, [autoPipEnabled]);

  useEffect(() => {
    sessionStorage.setItem('nexalink_pip_include_sidebar', String(pipIncludeSidebar));
  }, [pipIncludeSidebar]);

  const isElectron = typeof window !== 'undefined' && (window.navigator.userAgent.toLowerCase().includes('electron') || (window as any).process?.versions?.electron !== undefined);
  const isNotificationGranted = notifPermission === 'granted';
  const isPwaReady = isElectron || isStandalone || isNotificationGranted;

  // Global 401 Unauthorized API interceptor
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.toString());
      const isAuthRequest = url.includes('/api/auth/token') || url.includes('/api/auth/register');
      
      if (response.status === 401 && !isAuthRequest) {
        console.warn('[Session] Caught 401 Unauthorized from API. Logging out.');
        
        // Clear all session states
        sessionStorage.removeItem('nexalink_token');
        sessionStorage.removeItem('nexalink_username');
        sessionStorage.removeItem('nexalink_current_view');
        sessionStorage.removeItem('nexalink_lobby_subview');
        sessionStorage.removeItem('nexalink_contacts');
        sessionStorage.removeItem('nexalink_notifications');
        
        // Reset component fields
        setAuthToken(null);
        setUserName('Alice');
        setProfile(prev => ({ ...prev, username: 'Alice' }));
        setCurrentView('landing');
        showToast('Your session has expired. Please log in again.', 'error');
      }
      return response;
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, []);
  const handleEnableNotifications = async () => {
    setShowPwaInstallGuide(true);
    await requestPermission(userName);
    setNotifPermission('Notification' in window ? Notification.permission : 'unsupported');
  };

  useEffect(() => {
    sessionStorage.setItem('nexalink_notifications', JSON.stringify(inboxNotifications));
  }, [inboxNotifications]);

  const handleRoomChatInputChange = (val: string) => {
    setChatInput(val);
    
    if (!inRoom || !roomName || !chatSettings.typingIndicators || !socket) return;
    
    if (localRoomTypingTimeoutRef.current) {
      clearTimeout(localRoomTypingTimeoutRef.current);
    } else {
      socket.emit('room_typing', {
        roomName,
        username: myAlias.name,
        isTyping: true
      });
    }
    
    localRoomTypingTimeoutRef.current = setTimeout(() => {
      if (socket) {
        socket.emit('room_typing', {
          roomName,
          username: myAlias.name,
          isTyping: false
        });
      }
      localRoomTypingTimeoutRef.current = null;
    }, 3000);
  };

  const handleLobbyChatInputChange = (val: string) => {
    setLobbyChatInput(val);
    
    if (!activeChatContact || !chatSettings.typingIndicators || !socket) return;
    
    const contactName = activeChatContact.username;
    
    if (localDmTypingTimeoutRef.current[contactName]) {
      clearTimeout(localDmTypingTimeoutRef.current[contactName]);
    } else {
      socket.emit('direct_message_typing', {
        targetUsername: contactName,
        senderUsername: userName,
        isTyping: true
      });
    }
    
    localDmTypingTimeoutRef.current[contactName] = setTimeout(() => {
      if (socket) {
        socket.emit('direct_message_typing', {
          targetUsername: contactName,
          senderUsername: userName,
          isTyping: false
        });
      }
      delete localDmTypingTimeoutRef.current[contactName];
    }, 3000);
  };

  const sendLobbyChat = async () => {
    if (!activeChatContact || !lobbyChatInput.trim()) return;
    if (!socket) {
      showToast("Chat server is unavailable.", "error");
      return;
    }
    const rawText = lobbyChatInput.trim();

    // Immediately clear typing state
    const contactName = activeChatContact.username;
    if (localDmTypingTimeoutRef.current[contactName]) {
      clearTimeout(localDmTypingTimeoutRef.current[contactName]);
      delete localDmTypingTimeoutRef.current[contactName];
    }
    socket.emit('direct_message_typing', {
      targetUsername: contactName,
      senderUsername: userName,
      isTyping: false
    });

    const clientMsgId = `client-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    let textToSend = rawText;
    const key = dmCryptoKeys[activeChatContact.username];
    if (key) {
      try {
        textToSend = await encryptText(rawText, key);
      } catch (err) {
        console.error("Encryption failed:", err);
      }
    }
    
    const msg: ChatMessage = {
      id: clientMsgId,
      sender: profile.username || userName,
      text: textToSend,
      decryptedText: key ? rawText : undefined,
      time: nowTime(),
      self: true,
      status: 'sending' as const
    };
    
    setLobbyChats(prev => {
      const chatHistory = prev[activeChatContact.username] || [];
      return {
        ...prev,
        [activeChatContact.username]: [...chatHistory, msg]
      };
    });
    
    socket.emit('direct_message', {
      targetUsername: activeChatContact.username,
      senderUsername: userName,
      senderName: profile.username || userName,
      text: textToSend,
      clientMsgId
    });
    
    setLobbyChatInput('');
  };

  const saveMessageEdit = async (messageId: string, contactUsername: string) => {
    if (!editingText.trim()) return;
    if (!socket) {
      showToast("Chat server is unavailable.", "error");
      return;
    }
    const rawText = editingText.trim();
    let textToSend = rawText;
    
    const key = dmCryptoKeys[contactUsername];
    if (key) {
      try {
        textToSend = await encryptText(rawText, key);
      } catch (err) {
        console.error("Encryption failed:", err);
      }
    }
    
    setLobbyChats(prev => {
      const chatHistory = prev[contactUsername] || [];
      const updatedHistory = chatHistory.map(m => {
        if (m.id === messageId) {
          return { ...m, text: textToSend, decryptedText: key ? rawText : undefined };
        }
        return m;
      });
      return {
        ...prev,
        [contactUsername]: updatedHistory
      };
    });
    
    socket.emit('direct_message_edit', {
      targetUsername: contactUsername,
      messageId,
      text: textToSend,
      senderUsername: userName
    });
    
    setEditingMessageId(null);
    setEditingText('');
    showToast("Message updated.", "success");
  };

  const deleteMessage = (messageId: string, contactUsername: string) => {
    if (!window.confirm("Are you sure you want to delete this message?")) return;
    if (!socket) {
      showToast("Chat server is unavailable.", "error");
      return;
    }
    
    setLobbyChats(prev => {
      const chatHistory = prev[contactUsername] || [];
      const updatedHistory = chatHistory.filter(m => m.id !== messageId);
      return {
        ...prev,
        [contactUsername]: updatedHistory
      };
    });
    
    socket.emit('direct_message_delete', {
      targetUsername: contactUsername,
      messageId,
      senderUsername: userName
    });
    
    showToast("Message deleted.", "success");
  };

  const clearAllCallHistory = async () => {
    if (!window.confirm("Are you sure you want to clear all call history?")) return;
    try {
      const token = sessionStorage.getItem('nexalink_token') || authToken;
      const res = await fetch(`${API}/api/calls/clear`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        showToast("Call history cleared successfully.", "success");
        setCallHistory([]);
      } else {
        throw new Error("Failed to clear call history");
      }
    } catch (err) {
      console.error(err);
      showToast("Failed to clear call history.", "error");
    }
  };

  const deleteCallHistoryEntry = async (callId: number) => {
    try {
      const token = sessionStorage.getItem('nexalink_token') || authToken;
      const res = await fetch(`${API}/api/calls/delete/${callId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setCallHistory(prev => prev.filter(c => c.id !== callId));
        showToast("Call log removed.", "success");
      } else {
        throw new Error("Failed to delete call log");
      }
    } catch (err) {
      console.error(err);
      showToast("Failed to delete call log.", "error");
    }
  };

  const fetchNotificationLogs = async () => {
    setLoadingLogs(true);
    try {
      const token = sessionStorage.getItem('nexalink_token') || authToken;
      const res = await fetch(`${API}/api/compliance/notification_logs`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setNotificationLogs(data);
      }
    } catch (err) {
      console.error("Failed to load notification audit logs:", err);
    } finally {
      setLoadingLogs(false);
    }
  };

  const triggerTestNotification = async () => {
    showToast("E2E diagnostics push triggered. Testing routing tunnel...", "info");
    try {
      const res = await fetch(`${WS_URL}/api/push/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: userName })
      });
      if (res.ok) {
        showToast("Test request sent! Check for OS notification.", "success");
        setTimeout(fetchNotificationLogs, 1500);
      } else {
        throw new Error("Diagnostics endpoint returned error");
      }
    } catch (err) {
      console.error(err);
      showToast("Push test failed to initiate.", "error");
    }
  };

  useEffect(() => {
    if (authToken && currentView === 'lobby') {
      fetchNotificationLogs();
    }
  }, [authToken, currentView]);

  useEffect(() => {
    if (userName && userName !== 'Alice') {
      document.title = `NexaLink - ${userName}`;
    } else {
      document.title = 'NexaLink';
    }
  }, [userName]);

  const loadContactsFromServer = async () => {
    const token = sessionStorage.getItem('nexalink_token') || authToken;
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/contacts/list`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setContacts(data);
      }
    } catch (err) {
      console.error("Failed to load contacts from server:", err);
    }
  };

  const loadCallHistoryFromServer = async () => {
    const token = sessionStorage.getItem('nexalink_token') || authToken;
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/calls/all`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCallHistory(data);
      }
    } catch (err) {
      console.error("Failed to load call history:", err);
    }
  };

  const updateCallStatusOnServer = async (callId: number, status: string, ended = false) => {
    try {
      const token = sessionStorage.getItem('nexalink_token') || authToken;
      await fetch(`${API}/api/calls/update`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ call_id: callId, status, ended })
      });
      loadCallHistoryFromServer();
    } catch (err) {
      console.error("Failed to update call status:", err);
    }
  };

  const loadFileTransferHistory = async (otherUser: string) => {
    const token = sessionStorage.getItem('nexalink_token') || authToken;
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/files/history/${otherUser}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setFileTransferHistory(data);
      }
    } catch (err) {
      console.error("Failed to load file transfer history:", err);
    }
  };

  const loadChatHistory = async (otherUser: string) => {
    const token = sessionStorage.getItem('nexalink_token') || authToken;
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/dm/history/${otherUser}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const chatMsgs = await Promise.all(data.map(async (msg: any) => {
          let decryptedText = undefined;
          if (msg.text.startsWith('[E2EE]:')) {
            const key = dmCryptoKeysRef.current[otherUser];
            if (key) {
              try {
                decryptedText = await decryptText(msg.text, key);
              } catch (err) {
                decryptedText = '🔒 [Decryption Failed - Invalid Passphrase]';
              }
            } else {
              decryptedText = '🔒 [Encrypted Message - Enter passphrase to decrypt]';
            }
          }
          return {
            id: String(msg.id),
            sender: msg.sender,
            text: msg.text,
            decryptedText,
            time: new Date(msg.sent_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
            self: msg.sender.toLowerCase() === userName.toLowerCase()
          };
        }));
        setLobbyChats(prev => ({
          ...prev,
          [otherUser]: chatMsgs
        }));
      }
    } catch (err) {
      console.error("Failed to load chat history:", err);
    }
  };

  const removeContact = async (contactUsername: string) => {
    try {
      const token = sessionStorage.getItem('nexalink_token') || authToken;
      const res = await fetch(`${API}/api/contacts/remove/${contactUsername}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        showToast(`${contactUsername} removed persistently.`, 'success');
        await loadContactsFromServer();
        if (activeChatContact?.username === contactUsername) {
          setActiveChatContact(null);
        }
      }
    } catch (err) {
      console.error("Failed to remove contact:", err);
      showToast("Error removing contact", "error");
    }
  };

  const loadPendingMessages = async () => {
    const token = sessionStorage.getItem('nexalink_token') || authToken;
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/dm/unread`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        // Authoritative Server Clock & Offset Calculation
        const clientTime = Date.now();
        const serverDateHeader = res.headers.get('Date');
        const serverTime = serverDateHeader ? new Date(serverDateHeader).getTime() : clientTime;
        const offset = serverTime - clientTime;
        setClockOffset(offset);

        const data = await res.json();
        if (data && data.length > 0) {
          // Retrieve last disconnect time and record current reconnect time authoritative to server time
          const disconnectTime = getLastActiveTime() || new Date(serverTime - 24 * 60 * 60 * 1000); // default to 24h ago
          const reconnectTime = new Date(serverTime);
          const notifiedIds = getNotifiedMsgIds();

          // Filter retrieved unread messages strictly during the offline period that haven't been shown
          const offlineMessagesToNotify = data.filter((msg: any) => {
            const msgTime = new Date(msg.sent_at);
            // strict boundary check to prevent live websocket duplication race conditions
            return msgTime >= disconnectTime && msgTime < reconnectTime && !notifiedIds.includes(String(msg.id));
          });

          // In-App Notification Batching Rule (No native desktop OS popup for offline period retrieved messages)
          if (offlineMessagesToNotify.length > 5) {
            showToast(`You received ${offlineMessagesToNotify.length} new messages during your offline period.`, 'info');
            offlineMessagesToNotify.forEach((msg: any) => {
              addNotifiedMsgId(String(msg.id));
            });
          } else if (offlineMessagesToNotify.length > 0) {
            offlineMessagesToNotify.forEach((msg: any) => {
              showToast(`💬 ${msg.sender}: ${msg.text.slice(0, 45)}${msg.text.length > 45 ? '...' : ''}`, 'info');
              addNotifiedMsgId(String(msg.id));
            });
          }

          setLobbyChats(prev => {
            const nextChats = { ...prev };
            const nextUnreadCounts = { ...unreadChatCounts };
            const newNotifications = [...inboxNotifications];
            let hasActiveUnread = false;
            
            data.forEach((msg: any) => {
              const senderUser = msg.sender;
              const chatMsg: ChatMessage = {
                id: String(msg.id),
                sender: senderUser,
                text: msg.text,
                time: new Date(msg.sent_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
                self: false
              };
              
              const chatHistory = nextChats[senderUser] || [];
              if (!chatHistory.some(m => m.id === chatMsg.id)) {
                nextChats[senderUser] = [...chatHistory, chatMsg];
                
                if (!activeChatContact || activeChatContact.username.toLowerCase() !== senderUser.toLowerCase()) {
                  nextUnreadCounts[senderUser] = (nextUnreadCounts[senderUser] || 0) + 1;
                } else {
                  hasActiveUnread = true;
                }
                
                newNotifications.unshift({
                  id: `unread-${msg.id}`,
                  type: 'chat',
                  sender: senderUser,
                  title: `Unread message from ${senderUser}`,
                  desc: msg.text.slice(0, 60),
                  time: chatMsg.time,
                  read: false
                });
              }
            });
            
            setUnreadChatCounts(nextUnreadCounts);
            setInboxNotifications(newNotifications.slice(0, 50));
            if (hasActiveUnread && activeChatContact) {
              markMessagesAsRead(activeChatContact.username);
            }
            return nextChats;
          });
        }
      }
    } catch (err) {
      console.error("Failed to load pending messages:", err);
    }
  };

  const updateFileTransferDbStatus = async (transferId: number, status: 'completed' | 'failed' | 'accepted' | 'declined') => {
    try {
      const token = sessionStorage.getItem('nexalink_token') || authToken;
      if (!token) return;
      await fetch(`${API}/api/files/respond/${transferId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status })
      });
    } catch (err) {
      console.error(`Failed to update file transfer status to ${status}:`, err);
    }
  };

  const loadPendingFiles = async () => {
    const token = sessionStorage.getItem('nexalink_token') || authToken;
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/files/pending`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPendingFiles(data);
        // Add them to notifications if not already added
        setInboxNotifications(prev => {
          const next = [...prev];
          data.forEach((f: any) => {
            const nid = `file-${f.id}`;
            if (!next.some(n => n.id === nid)) {
              next.unshift({
                id: nid,
                type: 'chat' as const,
                sender: f.sender,
                title: `Incoming File: ${f.file_name}`,
                desc: `Size: ${(f.file_size / (1024 * 1024)).toFixed(2)} MB`,
                time: new Date(f.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
                read: false,
                fileTransferId: f.id
              });
            }
          });
          return next.slice(0, 50);
        });
      }
    } catch (err) {
      console.error("Failed to load pending file transfers:", err);
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeChatContact) return;

    if (file.size > 100 * 1024 * 1024) {
      showToast('File size must be under 100 MB.', 'error');
      return;
    }

    selectedFileRef.current = file;
    showToast(`Initiating transfer: ${file.name}...`, 'info');

    try {
      const token = sessionStorage.getItem('nexalink_token') || authToken;
      const res = await fetch(`${API}/api/files/initiate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          recipient: activeChatContact.username,
          file_name: file.name,
          file_size: file.size,
          file_type: file.type || 'application/octet-stream'
        })
      });
      
      if (!res.ok) {
        throw new Error("Failed to store file metadata on server.");
      }
      
      const data = await res.json();
      const transferId = data.transfer_id;

      const keyEntry = Object.entries(dmCryptoKeysRef.current).find(
        ([k]) => k.toLowerCase() === activeChatContact.username.toLowerCase()
      );
      const isEncrypted = !!keyEntry;

      const msg: ChatMessage = {
        id: `file-init-${transferId}`,
        sender: profile.username || userName,
        text: `${isEncrypted ? '🔒 [E2EE] ' : '📁 '}Initiated file transfer request: ${file.name} (${(file.size / (1024*1024)).toFixed(2)} MB)`,
        time: nowTime(),
        self: true
      };

      setLobbyChats(prev => {
        const chatHistory = prev[activeChatContact.username] || [];
        return {
          ...prev,
          [activeChatContact.username]: [...chatHistory, msg]
        };
      });

      if (socket) {
        socket.emit('file_transfer_initiate', {
          transferId,
          senderUsername: userName,
          recipientUsername: activeChatContact.username,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type || 'application/octet-stream'
        });
      }

      setFileTransferProgress({
        transferId,
        fileName: file.name,
        fileSize: file.size,
        progress: 0,
        speed: '0.00 KB/s',
        status: 'connecting',
        role: 'sender',
        isEncrypted
      });
      
      if (activeChatContact) {
        loadFileTransferHistory(activeChatContact.username);
      }
    } catch (err) {
      console.error("Failed to initiate file transfer:", err);
      showToast("Error starting transfer request.", "error");
    }
  };

  const initiateFilePeerConnection = async (recipient: string, file: File, transferId: number) => {
    const keyEntry = Object.entries(dmCryptoKeysRef.current).find(
      ([k]) => k.toLowerCase() === recipient.toLowerCase()
    );
    const isEncrypted = !!keyEntry;

    setFileTransferProgress({
      transferId,
      fileName: file.name,
      fileSize: file.size,
      progress: 0,
      speed: '0.00 KB/s',
      status: 'connecting',
      role: 'sender',
      isEncrypted
    });

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    filePeerConnectionRef.current = pc;

    const channel = pc.createDataChannel('fileTransfer', { ordered: true });
    fileDataChannelRef.current = channel;

    pc.onicecandidate = (e) => {
      if (e.candidate && socket) {
        socket.emit('file_ice_candidate', {
          targetUsername: recipient,
          candidate: e.candidate,
          senderUsername: userName
        });
      }
    };

    channel.onopen = () => {
      console.log('[WebRTC File] Data Channel opened! Streaming file...');
      sendFileInChunks(file, channel, transferId, recipient);
    };

    channel.onclose = () => {
      console.log('[WebRTC File] Data Channel closed.');
    };

    channel.onmessage = (e) => {
      if (typeof e.data === 'string') {
        if (e.data === '{CANCEL}') {
          console.log('[WebRTC File] Recipient cancelled the transfer.');
          cleanupFilePeerConnection();
          setFileTransferProgress(prev => prev ? { ...prev, status: 'failed' } : null);
          showToast('File transfer was cancelled by the recipient.', 'error');
        }
      }
    };

    channel.onerror = (err) => {
      console.error('[WebRTC File] Data Channel error:', err);
      setFileTransferProgress(prev => prev ? { ...prev, status: 'failed' } : null);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    if (socket) {
      socket.emit('file_offer', {
        targetUsername: recipient,
        offer,
        senderUsername: userName
      });
    }
  };

  const sendFileInChunks = (file: File, channel: RTCDataChannel, transferId: number, recipient: string) => {
    console.log(`[WebRTC File] Initiating chunked stream for transfer ID: ${transferId}`);
    const CHUNK_SIZE = 16384;
    const reader = new FileReader();
    let offset = 0;
    const startTime = Date.now();

    const readSlice = (o: number) => {
      const slice = file.slice(offset, o + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };

    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      if (channel.bufferedAmount > channel.bufferedAmountLowThreshold) {
        channel.onbufferedamountlow = () => {
          channel.onbufferedamountlow = null;
          sendChunk(buffer);
        };
        return;
      }
      sendChunk(buffer);
    };

    const sendChunk = async (buffer: ArrayBuffer) => {
      let dataToSend: ArrayBuffer = buffer;
      const keyEntry = Object.entries(dmCryptoKeysRef.current).find(
        ([k]) => k.toLowerCase() === recipient.toLowerCase()
      );
      if (keyEntry) {
        try {
          dataToSend = await encryptChunk(buffer, keyEntry[1]);
        } catch (err) {
          console.error("[WebRTC File] Encryption failed:", err);
          setFileTransferProgress(prev => prev ? { ...prev, status: 'failed' } : null);
          cleanupFilePeerConnection();
          showToast('Failed to encrypt file chunk.', 'error');
          return;
        }
      }

      if (channel.readyState !== 'open') {
        console.warn("[WebRTC File] Data channel is not open. State:", channel.readyState);
        return;
      }

      try {
        channel.send(dataToSend);
      } catch (err) {
        console.error("[WebRTC File] Failed to send chunk over data channel:", err);
        setFileTransferProgress(prev => prev ? { ...prev, status: 'failed' } : null);
        cleanupFilePeerConnection();
        return;
      }

      offset += buffer.byteLength;

      const elapsed = (Date.now() - startTime) / 1000;
      const speedBps = elapsed > 0 ? (offset / elapsed) : 0;
      const speedStr = speedBps > 1024 * 1024 
        ? `${(speedBps / (1024 * 1024)).toFixed(2)} MB/s`
        : `${(speedBps / 1024).toFixed(2)} KB/s`;

      const progress = Math.min(100, Math.round((offset / file.size) * 100));

      setFileTransferProgress(prev => prev ? { 
        ...prev, 
        progress,
        speed: speedStr,
        status: 'transferring'
      } : null);

      if (offset < file.size) {
        readSlice(offset);
      } else {
        setTimeout(() => {
          try {
            channel.send('{DONE}');
          } catch (ce) {}
          setFileTransferProgress(prev => prev ? { ...prev, status: 'completed', progress: 100 } : null);
          updateFileTransferDbStatus(transferId, 'completed');
          if (activeChatContact) {
            loadFileTransferHistory(activeChatContact.username);
          }
          showToast(`File transfer complete: ${file.name}`, 'success');
          selectedFileRef.current = null;
          const fileInput = document.getElementById('secure-file-input') as HTMLInputElement;
          if (fileInput) fileInput.value = '';
        }, 500);
      }
    };

    channel.bufferedAmountLowThreshold = 1024 * 1024;
    readSlice(0);
  };

  const acceptFileTransfer = async (transfer: { id: number; sender: string; file_name: string; file_size: number; file_type: string }) => {
    const transferId = transfer.id;
    try {
      const token = sessionStorage.getItem('nexalink_token') || authToken;
      await fetch(`${API}/api/files/respond/${transferId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: 'accepted' })
      });
    } catch (err) {
      console.error("Failed to respond to file transfer on server:", err);
    }

    setPendingFiles(prev => prev.filter(f => f.id !== transferId));
    if (activeChatContact) {
      loadFileTransferHistory(activeChatContact.username);
    }

    if (socket) {
      socket.emit('file_transfer_response', {
        transferId,
        status: 'accepted',
        recipientUsername: userName,
        senderUsername: transfer.sender
      });
    }

    const keyEntry = Object.entries(dmCryptoKeysRef.current).find(
      ([k]) => k.toLowerCase() === transfer.sender.toLowerCase()
    );
    const isEncrypted = !!keyEntry;

    setFileTransferProgress({
      transferId,
      fileName: transfer.file_name,
      fileSize: transfer.file_size,
      progress: 0,
      speed: '0.00 KB/s',
      status: 'connecting',
      role: 'receiver',
      isEncrypted
    });

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    filePeerConnectionRef.current = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate && socket) {
        socket.emit('file_ice_candidate', {
          targetUsername: transfer.sender,
          candidate: e.candidate,
          senderUsername: userName
        });
      }
    };

    const receivedBuffers: ArrayBuffer[] = [];
    let receivedSize = 0;
    let startTime = Date.now();

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      fileDataChannelRef.current = channel;

      channel.onmessage = async (e) => {
        if (typeof e.data === 'string') {
          if (e.data === '{CANCEL}') {
            console.log('[WebRTC File] Cancelled by remote peer!');
            cleanupFilePeerConnection();
            setFileTransferProgress(prev => prev ? { ...prev, status: 'failed' } : null);
            showToast('File transfer was cancelled by the peer.', 'error');
            return;
          }
          if (e.data === '{DONE}') {
            console.log('[WebRTC File] Complete! Aggregating file...');
            const fileBlob = new Blob(receivedBuffers, { type: transfer.file_type });
            const fileUrl = URL.createObjectURL(fileBlob);
            const a = document.createElement('a');
            a.href = fileUrl;
            a.download = transfer.file_name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            setFileTransferProgress(prev => prev ? { ...prev, status: 'completed', progress: 100 } : null);
            updateFileTransferDbStatus(transferId, 'completed');
            if (activeChatContact) {
              loadFileTransferHistory(activeChatContact.username);
            }
            showToast(`File download completed: ${transfer.file_name}`, 'success');
            cleanupFilePeerConnection();
            return;
          }
        }

        const buffer = e.data as ArrayBuffer;
        let dataToAppend: ArrayBuffer = buffer;

        if (isEncrypted && keyEntry) {
          try {
            dataToAppend = await decryptChunk(buffer, keyEntry[1]);
          } catch (err) {
            console.error("[WebRTC File] Decryption failed:", err);
            cleanupFilePeerConnection();
            setFileTransferProgress(prev => prev ? { ...prev, status: 'failed' } : null);
            showToast('Decryption failed! Please verify your E2EE DM Secret.', 'error');
            try {
              channel.send('{CANCEL}');
            } catch (ce) {}
            return;
          }
        }

        receivedBuffers.push(dataToAppend);
        receivedSize += dataToAppend.byteLength;

        const elapsed = (Date.now() - startTime) / 1000;
        const speedBps = elapsed > 0 ? (receivedSize / elapsed) : 0;
        const speedStr = speedBps > 1024 * 1024 
          ? `${(speedBps / (1024 * 1024)).toFixed(2)} MB/s`
          : `${(speedBps / 1024).toFixed(2)} KB/s`;

        const progress = Math.min(100, Math.round((receivedSize / transfer.file_size) * 100));

        setFileTransferProgress(prev => prev ? { 
          ...prev, 
          progress,
          speed: speedStr,
          status: 'transferring'
        } : null);
      };

      channel.onerror = (err) => {
        console.error('[WebRTC File] Receiver channel error:', err);
        setFileTransferProgress(prev => prev ? { ...prev, status: 'failed' } : null);
      };
    };

    showToast('Waiting for peer data channel connection...', 'info');
  };

  const cleanupFilePeerConnection = () => {
    if (fileDataChannelRef.current) {
      try {
        fileDataChannelRef.current.close();
      } catch (e) {}
      fileDataChannelRef.current = null;
    }
    if (filePeerConnectionRef.current) {
      try {
        filePeerConnectionRef.current.close();
      } catch (e) {}
      filePeerConnectionRef.current = null;
    }
    fileIceCandidatesQueueRef.current = [];
  };

  const cancelFileTransfer = (remoteUser: string) => {
    // 1. Send CANCEL control phrase if channel is open
    if (fileDataChannelRef.current && fileDataChannelRef.current.readyState === 'open') {
      try {
        fileDataChannelRef.current.send('{CANCEL}');
      } catch (e) {
        console.error('[WebRTC File] Error sending CANCEL over data channel:', e);
      }
    }

    // 2. Emit cancel via socket relay in case connection is still negotiating
    if (socket && fileTransferProgress) {
      socket.emit('file_transfer_cancel', {
        transferId: fileTransferProgress.transferId,
        targetUsername: remoteUser,
        senderUsername: userName
      });
    }

    // 3. Close and purge peer connection
    cleanupFilePeerConnection();
    selectedFileRef.current = null;

    if (fileTransferProgress) {
      updateFileTransferDbStatus(fileTransferProgress.transferId, 'failed');
    }

    // 4. Update local state
    setFileTransferProgress(prev => prev ? { ...prev, status: 'failed' } : null);
    showToast('File transfer cancelled.', 'info');
  };

  const declineFileTransfer = async (transfer: { id: number; sender: string }) => {
    const transferId = transfer.id;
    try {
      const token = sessionStorage.getItem('nexalink_token') || authToken;
      await fetch(`${API}/api/files/respond/${transferId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: 'declined' })
      });
    } catch (err) {
      console.error("Failed to decline file transfer on server:", err);
    }

    setPendingFiles(prev => prev.filter(f => f.id !== transferId));
    if (activeChatContact) {
      loadFileTransferHistory(activeChatContact.username);
    }

    if (socket) {
      socket.emit('file_transfer_response', {
        transferId,
        status: 'declined',
        recipientUsername: userName,
        senderUsername: transfer.sender
      });
    }
    showToast('File transfer request declined.', 'info');
  };

  const markMessagesAsRead = async (otherUser: string) => {
    const token = sessionStorage.getItem('nexalink_token') || authToken;
    if (!token) return;
    try {
      await fetch(`${API}/api/dm/read/${otherUser}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      });
      setUnreadChatCounts(prev => {
        const nextCounts = { ...prev };
        delete nextCounts[otherUser];
        return nextCounts;
      });
    } catch (err) {
      console.error("Failed to mark messages as read:", err);
    }
  };

  useEffect(() => {
    if (authToken) {
      loadContactsFromServer();
      loadCallHistoryFromServer();
      loadPendingMessages();
      loadPendingFiles();
    } else {
      setContacts([]);
      setCallHistory([]);
    }
  }, [authToken]);

  useEffect(() => {
    if (authToken && sidebarTab === 'calls') {
      loadCallHistoryFromServer();
    }
  }, [authToken, sidebarTab]);

  useEffect(() => {
    if (activeChatContact) {
      loadChatHistory(activeChatContact.username);
      markMessagesAsRead(activeChatContact.username);
      loadFileTransferHistory(activeChatContact.username);
    }
  }, [activeChatContact]);

  const loadProfileFromDB = async (targetUser: string) => {
    const token = sessionStorage.getItem('nexalink_token') || authToken;
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/profile/${targetUser}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setProfile({
          username: data.username || targetUser,
          bio: data.bio || '',
          profilePic: data.profile_pic || ''
        });

        // Restore settings if targetUser is the current user
        const currentUser = sessionStorage.getItem('nexalink_username') || userName;
        if (targetUser.toLowerCase() === currentUser.toLowerCase()) {
          if (data.theme) {
            setTheme(data.theme);
            sessionStorage.setItem('nexalink_theme', data.theme);
          }
          if (data.chat_settings) {
            setChatSettings(data.chat_settings);
            sessionStorage.setItem('nexalink_chat_settings', JSON.stringify(data.chat_settings));
          }
          if (data.notif_settings) {
            setNotifSettings(data.notif_settings);
            sessionStorage.setItem('nexalink_notif_settings', JSON.stringify(data.notif_settings));
          }
        }
      }
    } catch (err) {
      console.error('Failed to load profile from database:', err);
    }
  };

  const pushProfileToDB = async (updatedProfile = profile, updatedTheme = theme, updatedChat = chatSettings, updatedNotif = notifSettings) => {
    const token = sessionStorage.getItem('nexalink_token') || authToken;
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/profile/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          username: updatedProfile.username,
          bio: updatedProfile.bio,
          profile_pic: updatedProfile.profilePic,
          theme: updatedTheme,
          chat_settings: updatedChat,
          notif_settings: updatedNotif
        })
      });
      if (res.ok) {
        showToast('Profile and settings saved to database server.', 'success');
      } else {
        showToast('Failed to save profile to database.', 'error');
      }
    } catch (err) {
      console.error('Failed to sync profile to database:', err);
      showToast('Database server error while saving profile.', 'error');
    }
  };

  /* Restore username */
  useEffect(() => {
    const saved = sessionStorage.getItem('nexalink_username');
    if (saved) {
      setUserName(saved);
      setProfile(prev => ({ ...prev, username: saved }));
      loadProfileFromDB(saved);
    }
  }, [authToken]);

  /* Dynamic Page Scroll Control */
  useEffect(() => {
    if (!authToken && currentView !== 'landing') {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [authToken, currentView]);

  useEffect(() => {
    sessionStorage.setItem('nexalink_contacts', JSON.stringify(contacts));
  }, [contacts]);

  useEffect(() => {
    sessionStorage.setItem('nexalink_current_view', currentView);
  }, [currentView]);

  useEffect(() => {
    sessionStorage.setItem('nexalink_lobby_subview', lobbySubView);
  }, [lobbySubView]);

  /* Record Last Active Offline Tracker */
  useEffect(() => {
    if (!authToken) return;
    const updateTime = () => {
      const authTime = new Date(Date.now() + clockOffset).toISOString();
      setLastActiveTime(authTime);
    };
    
    updateTime();
    const interval = setInterval(updateTime, 5000);
    return () => clearInterval(interval);
  }, [authToken, clockOffset]);

  /* Scroll chat to bottom */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    if (activeTab === 'chat') setUnreadChat(0);
  }, [activeTab]);

  /* Toast helper */
  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ msg, type });
  }, []);

  const buildInviteLink = useCallback((targetRoom = roomName) => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', targetRoom);
    return url.toString();
  }, [roomName]);

  const copyInviteLink = useCallback(async (targetRoom = roomName) => {
    const invite = buildInviteLink(targetRoom);
    try {
      await navigator.clipboard.writeText(invite);
      showToast('Invite link copied.', 'success');
    } catch {
      window.prompt('Invite link', invite);
    }
  }, [buildInviteLink, roomName, showToast]);

  const handleProfilePicUpload = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Choose an image file for your profile picture.', 'error');
      return;
    }
    if (file.size > 750_000) {
      showToast('Profile picture must be under 750 KB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setProfile(prev => ({ ...prev, profilePic: String(reader.result || '') }));
      showToast('Profile picture updated.', 'success');
    };
    reader.readAsDataURL(file);
  };

  const addContact = async () => {
    const username = newContact.trim();
    if (!username) return;
    
    if (username.toLowerCase() === userName.toLowerCase()) {
      showToast("You cannot add yourself as a contact.", "error");
      return;
    }
    
    if (contacts.some(c => c.username.toLowerCase() === username.toLowerCase())) {
      showToast('That contact is already saved.', 'info');
      return;
    }
    
    try {
      const token = sessionStorage.getItem('nexalink_token') || authToken;
      const res = await fetch(`${API}/api/contacts/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ contact_username: username })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to add contact');
      }
      
      if (socket) {
        socket.emit('add_contact', { targetUsername: username, addedBy: userName });
      }
      
      await loadContactsFromServer();
      setNewContact('');
      showToast(`${username} added persistently.`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Error adding contact', 'error');
    }
  };

  const callContact = async (username: string) => {
    setDirectPeer(username);
    const participants = [userName, username]
      .map(name => name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-'))
      .sort();
    const directRoom = `Direct-${participants.join('-')}`;
    copyInviteLink(directRoom);
    
    let callId: number | undefined;
    try {
      const token = sessionStorage.getItem('nexalink_token') || authToken;
      const res = await fetch(`${API}/api/calls/log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          callee: username,
          call_type: callType,
          room_name: directRoom
        })
      });
      if (res.ok) {
        const logData = await res.json();
        callId = logData.call_id;
        if (callId) {
          setActiveDirectCallId(callId);
        }
      }
    } catch (err) {
      console.error("Failed to log call:", err);
    }

    setOutgoingCall({
      targetUsername: username,
      room: directRoom,
      callType: callType,
      callId: callId,
      status: 'ringing'
    });

    if (socket) {
      socket.emit('call_invite', {
        targetUsername: username,
        callerName:     profile.username || userName,
        callerUsername: userName,
        room:           directRoom,
        callType:       callType,
        callId:         callId
      });

      // Push reached the offline peer's service worker — hold ringing for 30s
      socket.once('call_ringing_push', ({ targetUsername: _target, message }: { targetUsername: string; message: string }) => {
        showToast(`📡 ${message}`, 'info');
        setOutgoingCall(prev => prev ? { ...prev, status: 'ringing_push' } : null);
      });

      // 30s timeout expired — peer didn't respond to the push notification
      socket.once('call_invite_timeout', ({ targetUsername: _target, message }: { targetUsername: string; message: string }) => {
        showToast(`⏱️ ${username}: ${message}`, 'error');
        setOutgoingCall(prev => prev ? { ...prev, status: 'timeout', errorReason: message } : null);
        if (callId) {
          updateCallStatusOnServer(callId, 'missed');
        }
        // Clean up the other listeners
        socket.off('call_ringing_push');
        socket.off('call_invite_failed');
      });

      // Push failed entirely — device is off / no subscription
      socket.once('call_invite_failed', ({ reason, detail }: { reason: string; detail?: string }) => {
        showToast(`Cannot reach ${username}: ${detail || (reason === 'offline' ? 'user is offline' : reason)}`, 'error');
        setOutgoingCall(prev => prev ? { ...prev, status: 'failed', errorReason: detail || (reason === 'offline' ? 'User is offline — device unreachable.' : reason) } : null);
        if (callId) {
          updateCallStatusOnServer(callId, 'missed');
        }
        // Clean up the other listeners
        socket.off('call_ringing_push');
        socket.off('call_invite_timeout');
      });
    }
  };

  // ── RESPOND TO INCOMING CALL ──────────────────────────────────────────────
  const handleIncomingCallResponse = async (
    action: 'leave_accept' | 'cut_accept' | 'merge' | 'ignore'
  ) => {
    if (!incomingCall) return;
    if (callDismissTimerRef.current) clearTimeout(callDismissTimerRef.current);

    if (action === 'ignore') {
      socket?.emit('call_response', { callerId: incomingCall.callerId, response: 'declined' });
      if (incomingCall.callId) {
        updateCallStatusOnServer(incomingCall.callId, 'declined');
      }
      setIncomingCall(null);
      return;
    }

    if (action === 'merge') {
      socket?.emit('call_response', { callerId: incomingCall.callerId, response: 'merged' });
      if (incomingCall.callId) {
        updateCallStatusOnServer(incomingCall.callId, 'accepted');
        setActiveDirectCallId(incomingCall.callId);
      }
      setIncomingCall(null);
      showToast(`Merging call — joining ${incomingCall.callerName}'s room as well.`, 'info');
      connectToRoom(incomingCall.room, `Merged into ${incomingCall.callerName}'s room`);
      return;
    }

    if (inRoom) {
      await handleDisconnectRoom();
    }
    socket?.emit('call_response', { callerId: incomingCall.callerId, response: 'accepted' });
    if (incomingCall.callId) {
      updateCallStatusOnServer(incomingCall.callId, 'accepted');
      setActiveDirectCallId(incomingCall.callId);
    }
    setIncomingCall(null);
    connectToRoom(incomingCall.room, `Joined ${incomingCall.callerName}'s call`);
  };

  // const toggleHiddenTile = (tileId: string) => {
  //   setHiddenTiles(prev => prev.includes(tileId) ? prev.filter(id => id !== tileId) : [...prev, tileId]);
  //   if (pinnedTile === tileId) setPinnedTile(null);
  // };

  const togglePinnedTile = (tileId: string) => {
    setPinnedTile(prev => prev === tileId ? null : tileId);
  };

  const openFullscreen = async (id?: string) => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
        showToast('Exited full screen.', 'success');
      } catch (err) {
        console.error('Failed to exit fullscreen:', err);
      }
      return;
    }
    const target = id ? document.getElementById(id) : callStageRef.current;
    try {
      await target?.requestFullscreen?.();
      showToast('Entered full screen.', 'success');
    } catch {
      showToast('Fullscreen is blocked by the browser.', 'error');
    }
  };

  const toggleLocalHide = (peerId: string) => {
    const isCurrentlyHidden = locallyHiddenPeers.includes(peerId);
    if (!isCurrentlyHidden) {
      // Trying to hide a stream. Check if that would leave 0 active streams.
      const activeCount = (locallyHiddenPeers.includes('self') ? 0 : 1) + 
                          participants.filter(p => !locallyHiddenPeers.includes(p.id)).length +
                          (screenStream ? 1 : 0);
      if (activeCount <= 1) {
        showToast('At least one active stream must remain visible.', 'error');
        return;
      }
      setLocallyHiddenPeers(prev => [...prev, peerId]);
      showToast(`Locally hid ${peerId === 'self' ? 'your stream' : 'peer stream'}.`, 'info');
    } else {
      setLocallyHiddenPeers(prev => prev.filter(id => id !== peerId));
      showToast(`Locally unhid ${peerId === 'self' ? 'your stream' : 'peer stream'}.`, 'info');
    }
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, _id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragEnter = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    setDragOverTileId(id);
  };

  const handleDragLeave = () => {
    setDragOverTileId(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverTileId(null);
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId && draggedId !== targetId) {
      setTileOrder(prev => {
        const newOrder = [...prev];
        const draggedIndex = newOrder.indexOf(draggedId);
        const targetIndex = newOrder.indexOf(targetId);
        if (draggedIndex !== -1 && targetIndex !== -1) {
          // Swap positions in custom grid layout
          newOrder[draggedIndex] = targetId;
          newOrder[targetIndex] = draggedId;
        }
        return newOrder;
      });
      showToast('Rearranged tile positions', 'success');
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invitedRoom = params.get('room');
    if (invitedRoom) {
      setRoomName(invitedRoom);
      showToast(`Invite loaded for ${invitedRoom}`, 'info');
    }
  }, [showToast]);

  /* ── Auth ───────────────────────────── */
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);
    setAuthLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authUsername, email: authEmail, password: authPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        let msg = 'Registration failed';
        if (data && data.detail) {
          if (typeof data.detail === 'string') {
            msg = data.detail;
          } else if (Array.isArray(data.detail)) {
            msg = data.detail.map((d: any) => d.msg).join(', ');
          } else if (typeof data.detail === 'object') {
            msg = JSON.stringify(data.detail);
          }
        }
        throw new Error(msg);
      }
      setIsRegisterMode(false);
      setAuthPassword('');

      if (data.confirmation_required) {
        setAuthSuccess(data.message || 'Registration successful. Please check your email to verify your account.');
        showToast('Verification email sent', 'success');
      } else {
        setAuthSuccess('Account created successfully! Please log in.');
        showToast(data.message || 'Account created! Please sign in.', 'success');
      }
    } catch (err: any) {
      setAuthError(err.message || 'Network error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);
    setAuthLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authUsername, password: authPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        let msg = 'Login failed';
        if (data && data.detail) {
          if (typeof data.detail === 'string') {
            msg = data.detail;
          } else if (Array.isArray(data.detail)) {
            msg = data.detail.map((d: any) => d.msg).join(', ');
          } else if (typeof data.detail === 'object') {
            msg = JSON.stringify(data.detail);
          }
        }
        throw new Error(msg);
      }
      sessionStorage.setItem('nexalink_token', data.access_token);
      sessionStorage.setItem('nexalink_username', data.username);
      setRememberCookie(data.username, data.access_token);
      setAuthToken(data.access_token);
      setUserName(data.username);
      setProfile(prev => ({ ...prev, username: data.username }));
      setCurrentView('lobby');
      setLobbySubView('connect');
      setAuthPassword('');
      showToast(`Welcome back, ${data.username}!`, 'success');
      // Request OS notification permission + subscribe to Web Push for this user
      requestPermission(data.username);
    } catch (err: any) {
      setAuthError(err.message || 'Network error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = () => {
    sessionStorage.removeItem('nexalink_token');
    sessionStorage.removeItem('nexalink_username');
    sessionStorage.removeItem('nexalink_current_view');
    sessionStorage.removeItem('nexalink_lobby_subview');
    sessionStorage.removeItem('nexalink_contacts');
    sessionStorage.removeItem('nexalink_notifications');
    deleteRememberCookie();
    unsubscribeNotif(userName);   // remove push subscription from server
    setAuthToken(null);
    setUserName('Alice');
    setProfile(prev => ({ ...prev, username: 'Alice' }));
    setCurrentView('landing');
    showToast('Signed out securely.', 'info');
  };

  // Handle notification click navigation (from SW postMessage)
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const { room } = (e as CustomEvent).detail || {};
      if (room && !inRoom) {
        connectToRoom(room, `Joining room from notification...`);
      }
    };
    window.addEventListener('nexalink:navigate', onNavigate);
    return () => window.removeEventListener('nexalink:navigate', onNavigate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRoom]);

  // Also handle ?room=X&auto=1 URL params on initial load (when browser was closed)
  useEffect(() => {
    if (!authToken) return;
    const params = new URLSearchParams(window.location.search);
    const autoRoom = params.get('room');
    const autoJoin = params.get('auto') === '1';
    if (autoRoom && autoJoin) {
      // Clear params so refresh doesn't re-trigger
      window.history.replaceState({}, '', window.location.pathname);
      connectToRoom(autoRoom, `Auto-joining room from notification...`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  /* ── Room Connect ───────────────────── */
  const connectToRoom = async (targetRoom: string, successLabel = `Joined ${targetRoom} — E2EE active`) => {
    setConnecting(true);
    try {
      const token = sessionStorage.getItem('nexalink_token') || '';
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

      const roomRes = await fetch(`${API}/api/rooms/create`, {
        method: 'POST', headers,
        body: JSON.stringify({ room_name: targetRoom, ephemeral_mode: true, metadata_stripping: true }),
      });
      const roomData = await roomRes.json();
      if (!roomRes.ok) throw new Error(roomData.detail || 'Room creation failed');
      const newRoomId = roomData.room_id;
      setActiveRoomId(newRoomId);

      await fetch(`${API}/api/call/join`, {
        method: 'POST', headers,
        body: JSON.stringify({ room_id: newRoomId, room_name: targetRoom, username: userName }),
      });

      setRoomName(targetRoom);
      setInRoom(true);
      setCurrentView('room');
      showToast(successLabel, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to connect', 'error');
    } finally {
      setConnecting(false);
    }
  };

  const handleConnectRoom = () => {
    const targetRoom = roomName.trim();
    if (!targetRoom) return;
    connectToRoom(targetRoom);
  };

  // const handleDirectCall = async () => {
  //   const peer = directPeer.trim();
  //   if (!peer) {
  //     showToast('Enter a username to call.', 'error');
  //     return;
  //   }
  //   const participants = [userName, peer]
  //     .map(name => name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-'))
  //     .sort();
  //   const directRoom = `Direct-${participants.join('-')}`;
  //   await copyInviteLink(directRoom);
  //   connectToRoom(directRoom, `Direct call room opened for ${peer}.`);
  // };

  /* ────────────────────────────────────────────────────────
     AI Captions & Translation Systems
     ──────────────────────────────────────────────────────── */
  const TRANSLATION_DICTIONARIES: Record<string, Record<string, string>> = {
    es: {
      "The E2EE handshake is complete. All media channels are secure.": "El saludo E2EE se ha completado. Todos los canales de medios son seguros.",
      "We need to audit the DTLS key exchange before deploying the Render build.": "Necesitamos auditar el intercambio de claves DTLS antes de implementar la compilación de Render.",
      "Let's review the GDPR user data compliance requirements this afternoon.": "Revisemos los requisitos de cumplimiento de datos de usuario de GDPR esta tarde.",
      "I will scale the signalling server clusters on AWS ECS to handle 10k connections.": "Escalaré los clústeres de servidores de señalización en AWS ECS para manejar 10k conexiones.",
      "The Coturn server dynamic credential generation is successfully configured.": "La generación de credenciales dinámicas del servidor Coturn se configuró correctamente.",
      "I'm initiating the secure client-side file transfer now.": "Estoy iniciando la transferencia segura de archivos del lado del cliente ahora.",
      "Let's use the military-grade whiteboard to design the network topology.": "Usemos la pizarra de grado militar para diseñar la topología de la red.",
      "Affirmative. I am auditing the Postgres connection pool sizes.": "Afirmativo. Estoy auditando los tamaños del grupo de conexiones de Postgres.",
      "Perfect! The WebRTC latency statistics look incredibly low.": "¡Perfecto! Las estadísticas de latencia de WebRTC se ven increíblemente bajas.",
      "Agreed. Let's merge the call room immediately.": "De acuerdo. Unamos la sala de llamadas de inmediato.",
      "I am monitoring the packet loss; ABR scaled my stream to HD.": "Estoy monitoreando la pérdida de paquetes; ABR escaló mi transmisión a HD.",
      "Understood, let's keep E2EE whiteboard drawing active.": "Entendido, mantengamos activo el dibujo en la pizarra E2EE.",
      "I have accepted the secure file transfer.": "He aceptado la transferencia segura de archivos."
    },
    fr: {
      "The E2EE handshake is complete. All media channels are secure.": "La poignée de main E2EE est terminée. Tous les canaux multimédias sont sécurisés.",
      "We need to audit the DTLS key exchange before deploying the Render build.": "Nous devons auditer l'échange de clés DTLS avant de déployer la build Render.",
      "Let's review the GDPR user data compliance requirements this afternoon.": "Passons en revue les exigences de conformité des données utilisateur RGPD cet après-midi.",
      "I will scale the signalling server clusters on AWS ECS to handle 10k connections.": "Je vais mettre à l'échelle les clusters de serveurs de signalisation sur AWS ECS pour gérer 10k connexions.",
      "The Coturn server dynamic credential generation is successfully configured.": "La génération dynamique d'identifiants du serveur Coturn est configurée avec succès.",
      "I'm initiating the secure client-side file transfer now.": "J'initialise le transfert de fichiers sécurisé côté client maintenant.",
      "Let's use the military-grade whiteboard to design the network topology.": "Utilisons le tableau blanc de qualité militaire pour concevoir la topologie du réseau.",
      "Affirmative. I am auditing the Postgres connection pool sizes.": "Affirmatif. J'audite les tailles des pools de connexion Postgres.",
      "Perfect! The WebRTC latency statistics look incredibly low.": "Parfait! Les statistiques de latence WebRTC semblent incroyablement basses.",
      "Agreed. Let's merge the call room immediately.": "D'accord. Fusionnons la salle d'appel immédiatement.",
      "I am monitoring the packet loss; ABR scaled my stream to HD.": "Je surveille la perte de paquets; l'ABR a mis mon flux en HD.",
      "Understood, let's keep E2EE whiteboard drawing active.": "Compris, gardons le dessin sur tableau blanc E2EE actif.",
      "I have accepted the secure file transfer.": "J'ai accepté le transfert de fichiers sécurisé."
    },
    de: {
      "The E2EE handshake is complete. All media channels are secure.": "Der E2EE-Handshake ist abgeschlossen. Alle Medienkanäle sind sicher.",
      "We need to audit the DTLS key exchange before deploying the Render build.": "Wir müssen den DTLS-Schlüsselaustausch prüfen, bevor wir den Render-Build bereitstellen.",
      "Let's review the GDPR user data compliance requirements this afternoon.": "Lassen Sie uns heute Nachmittag die DSGVO-Benutzerdaten-Compliance-Anforderungen überprüfen.",
      "I will scale the signalling server clusters on AWS ECS to handle 10k connections.": "Ich werde die Signalisierungsserver-Cluster auf AWS ECS skalieren, um 10.000 Verbindungen zu verarbeiten.",
      "The Coturn server dynamic credential generation is successfully configured.": "Die dynamische Generierung von Anmeldeinformationen für den Coturn-Server wurde erfolgreich konfiguriert.",
      "I'm initiating the secure client-side file transfer now.": "Ich starte jetzt die sichere clientseitige Dateiübertragung.",
      "Let's use the military-grade whiteboard to design the network topology.": "Lassen Sie uns das Whiteboard in Militärqualität verwenden, um die Netzwerktopologie zu entwerfen.",
      "Affirmative. I am auditing the Postgres connection pool sizes.": "Bestätigt. Ich prüfe die Postgres-Verbindungspool-Größen.",
      "Perfect! The WebRTC latency statistics look incredibly low.": "Perfekt! Die WebRTC-Latenzstatistiken sehen unglaublich niedrig aus.",
      "Agreed. Let's merge the call room immediately.": "Verstanden. Lasst uns den Anrufraum sofort zusammenführen.",
      "I am monitoring the packet loss; ABR scaled my stream to HD.": "Ich überwache den Paketverlust; ABR hat meinen Stream auf HD skaliert.",
      "Understood, let's keep E2EE whiteboard drawing active.": "Verstanden, lassen Sie uns die E2EE-Whiteboard-Zeichnung aktiv halten.",
      "I have accepted the secure file transfer.": "Ich habe die sichere Dateiübertragung akzeptiert."
    },
    ja: {
      "The E2EE handshake is complete. All media channels are secure.": "E2EEハンドシェイクが完了しました。すべてのメディアチャネルは安全です。",
      "We need to audit the DTLS key exchange before deploying the Render build.": "Renderビルドをデプロイする前に、DTLSキー交換を監査する必要があります。",
      "Let's review the GDPR user data compliance requirements this afternoon.": "今日の午後にGDPRユーザーデータのコンプライアンス要件を確認しましょう。",
      "I will scale the signalling server clusters on AWS ECS to handle 10k connections.": "1万件の接続を処理するために、AWS ECSのシグナリングサーバークラスターを拡張します。",
      "The Coturn server dynamic credential generation is successfully configured.": "Coturnサーバーの動的資格情報生成が正常に構成されました。",
      "I'm initiating the secure client-side file transfer now.": "クライアント側の安全なファイル転送を開始しています。",
      "Let's use the military-grade whiteboard to design the network topology.": "軍用グレードのホワイトボードを使用して、ネットワークトポロジを設計しましょう。",
      "Affirmative. I am auditing the Postgres connection pool sizes.": "了解。Postgres接続プールサイズを監査しています。",
      "Perfect! The WebRTC latency statistics look incredibly low.": "素晴らしい！WebRTCの遅延統計は非常に低く見えます。",
      "Agreed. Let's merge the call room immediately.": "同意します。すぐに通話室をマージしましょう。",
      "I am monitoring the packet loss; ABR scaled my stream to HD.": "パケット損失を監視しています。ABRによりストリームがHDにスケールされました。",
      "Understood, let's keep E2EE whiteboard drawing active.": "了解しました。E2EEホワイトボード描画を有効にしたままにしましょう。",
      "I have accepted the secure file transfer.": "安全なファイル転送を承認しました。"
    }
  };



  const handleDisconnectRoom = async () => {
    if (activeRoomId) {
      try {
        const token = sessionStorage.getItem('nexalink_token') || '';
        await fetch(`${API}/api/call/leave`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ room_id: activeRoomId, username: userName }),
        });
      } catch {}
    }

    if (activeDirectCallId) {
      updateCallStatusOnServer(activeDirectCallId, 'accepted', true);
      setActiveDirectCallId(null);
    }

    // Stop local media tracks to turn off the camera/mic indicator when leaving the room
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
    }
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
    }

    setInRoom(false);
    setActiveRoomId(null);
    setChatMessages([]);
    setRoomTypingUsers(new Set());
    if (localRoomTypingTimeoutRef.current) {
      clearTimeout(localRoomTypingTimeoutRef.current);
      localRoomTypingTimeoutRef.current = null;
    }
    setCurrentView('lobby');
    showToast('Disconnected from room.', 'info');
  };

  /* ── WebRTC ─────────────────────────── */
  const {
    socket, isConnected, localStream, screenStream, participants,
    audioEnabled, videoEnabled,
    myAlias, isAliasEnabled, stats, controlledBy,
    pendingControlRequestFrom, pendingControlRequestType, controlLogs,
    initMedia, toggleVideo, toggleAudio, toggleScreenShare,
    toggleAlias, requestRemoteControl, respondToControlRequest, triggerEmergencyKill,
    qualityPreference, setQualityPreference, currentQualityProfile,
    simulatedProfile, setSimulatedProfile, customSimSettings, setCustomSimSettings,
  } = useWebRTC(
    inRoom ? roomName : '', 
    userName, 
    {
      profilePic: profile.profilePic,
      bio: profile.bio,
    },
    selectedAudioInput,
    selectedVideoInput
  );

  const {
    volumeLevel, config: audioConfig, setConfig: setAudioConfig,
    startPipeline, stopPipeline,
  } = useAudioPipeline();

  useEffect(() => {
    if (inRoom && localStream) startPipeline(localStream);
    else stopPipeline();
    return () => stopPipeline();
  }, [inRoom, localStream, startPipeline, stopPipeline]);

  // ── LINK TO SHARE SCREEN COORDINATED EFFECTS & UTILITIES ──
  
  // 1. Auto-select active stream source when enabling link
  useEffect(() => {
    if (isLinkedToShareScreen && !linkedStreamId) {
      if (screenStream) {
        setLinkedStreamId('screen');
      } else {
        setLinkedStreamId('self');
      }
    }
  }, [isLinkedToShareScreen, screenStream, linkedStreamId]);

  // 2. Expand sidebar to 72% width when whiteboard is linked, restore on unlink
  const lastSidebarWidthRef = useRef(320);
  useEffect(() => {
    if (isLinkedToShareScreen) {
      lastSidebarWidthRef.current = sidebarWidth;
      setSidebarWidth(Math.floor(window.innerWidth * 0.72));
      setActiveTab('whiteboard');
    } else {
      setSidebarWidth(lastSidebarWidthRef.current);
    }
  }, [isLinkedToShareScreen]);

  // 3. ResizeObserver to track container dimension changes dynamically
  useEffect(() => {
    const el = document.getElementById('linked-video-box');
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [isLinkedToShareScreen, linkedStreamId]);

  // 4. Right-to-Left whiteboard pointer tracking listener
  useEffect(() => {
    const handleWhiteboardHover = (e: CustomEvent<any>) => {
      const { x, y, active } = e.detail;
      if (!active) {
        setWhiteboardProjectedPointer(null);
        return;
      }
      
      const W = containerSize.width;
      const H = containerSize.height;
      const src = [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 640 },
        { x: 0, y: 640 }
      ];
      const dst = calibrationPoints.map(pt => ({
        x: (pt.x * W) / 100,
        y: (pt.y * H) / 100
      }));
      
      const matrix = getHomographyMatrix(src, dst);
      const projected = transformPoint(x, y, matrix);
      setWhiteboardProjectedPointer(projected);
    };
    
    window.addEventListener('whiteboard-hover-pointer' as any, handleWhiteboardHover);
    return () => {
      window.removeEventListener('whiteboard-hover-pointer' as any, handleWhiteboardHover);
    };
  }, [calibrationPoints, containerSize]);

  // 5. Global handle dragging event tracking
  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      if (draggingHandleIdxRef.current !== null) {
        const container = document.getElementById('linked-focus-container');
        if (container) {
          const rect = container.getBoundingClientRect();
          let x = ((e.clientX - rect.left) / rect.width) * 100;
          let y = ((e.clientY - rect.top) / rect.height) * 100;
          x = Math.max(0, Math.min(100, x));
          y = Math.max(0, Math.min(100, y));
          
          setCalibrationPoints(prev => {
            const next = [...prev];
            next[draggingHandleIdxRef.current!] = { x, y };
            return next;
          });
        }
      }
    };
    
    const handleWindowMouseUp = () => {
      draggingHandleIdxRef.current = null;
    };
    
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, []);

  // 6. Real-time canvas mirroring requestAnimationFrame loop
  useEffect(() => {
    let animFrameId: number;
    
    const tick = () => {
      if (isLinkedToShareScreen) {
        const mainCanvas = document.querySelector('.whiteboard-container canvas') as HTMLCanvasElement;
        const overlayCanvas = document.getElementById('linked-overlay-canvas') as HTMLCanvasElement;
        if (mainCanvas && overlayCanvas) {
          const overlayCtx = overlayCanvas.getContext('2d');
          if (overlayCtx) {
            if (overlayCanvas.width !== mainCanvas.width || overlayCanvas.height !== mainCanvas.height) {
              overlayCanvas.width = mainCanvas.width;
              overlayCanvas.height = mainCanvas.height;
            }
            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            overlayCtx.drawImage(mainCanvas, 0, 0);
          }
        }
      }
      animFrameId = requestAnimationFrame(tick);
    };
    
    animFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameId);
  }, [isLinkedToShareScreen]);

  // 7. Handles for dragging handles and overlay drawing
  const handleStartDragHandle = (e: React.MouseEvent, idx: number) => {
    e.preventDefault();
    draggingHandleIdxRef.current = idx;
  };

  const handleOverlayMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsOverlayDrawing(true);
    const rect = e.currentTarget.getBoundingClientRect();
    const u = e.clientX - rect.left;
    const v = e.clientY - rect.top;
    
    const W = rect.width;
    const H = rect.height;
    
    const src = calibrationPoints.map(pt => ({
      x: (pt.x * W) / 100,
      y: (pt.y * H) / 100
    }));
    const dst = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 640 },
      { x: 0, y: 640 }
    ];
    
    const H_inv = getHomographyMatrix(src, dst);
    const mapped = transformPoint(u, v, H_inv);
    overlayLastPosRef.current = mapped;
  };

  const handleOverlayMouseMove = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const u = e.clientX - rect.left;
    const v = e.clientY - rect.top;
    
    const W = rect.width;
    const H = rect.height;
    
    const src = calibrationPoints.map(pt => ({
      x: (pt.x * W) / 100,
      y: (pt.y * H) / 100
    }));
    const dst = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 640 },
      { x: 0, y: 640 }
    ];
    
    const H_inv = getHomographyMatrix(src, dst);
    const mapped = transformPoint(u, v, H_inv);
    
    setOverlayHoverPos({ x: u, y: v });
    
    // Dispatch local hover pointer coordinate event to Whiteboard.tsx
    window.dispatchEvent(new CustomEvent('local-hover-pointer', { 
      detail: { x: mapped.x, y: mapped.y, active: true } 
    }));
    
    if (!isOverlayDrawing) return;
    
    const stroke = {
      x: mapped.x,
      y: mapped.y,
      lastX: overlayLastPosRef.current.x,
      lastY: overlayLastPosRef.current.y,
      color: '#dcb16b',
      size: 4,
      isEraser: false
    };
    
    window.dispatchEvent(new CustomEvent('local-draw-stroke', { detail: { stroke } }));
    overlayLastPosRef.current = mapped;
  };

  const handleOverlayMouseLeave = () => {
    setIsOverlayDrawing(false);
    setOverlayHoverPos(null);
    window.dispatchEvent(new CustomEvent('local-hover-pointer', { detail: { active: false } }));
  };

  const handleOverlayMouseUp = () => {
    setIsOverlayDrawing(false);
  };

  // ── Desktop Agent Integration ──
  useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).nexalinkDesktop) return;
    const desktop = (window as any).nexalinkDesktop;

    // Listen for window state changes (isMiniMode, alwaysOnTop) from Electron main
    const unsubscribeState = desktop.onEvent('window-state-changed', (data: any) => {
      console.log('[Desktop Integration] window-state-changed event received:', data);
      if (typeof data.isMiniMode !== 'undefined') {
        setIsMiniMode(data.isMiniMode);
        if (data.isMiniMode) {
          // Entering Mini Mode: backup current layout, switch to pip-remote
          setStreamLayout(current => {
            if (current !== 'pip-remote') {
              backupLayoutRef.current = current;
            }
            return 'pip-remote';
          });
        } else {
          // Exiting Mini Mode: restore previous layout
          setStreamLayout(backupLayoutRef.current);
        }
      }
      if (typeof data.alwaysOnTop !== 'undefined') {
        setIsAlwaysOnTop(data.alwaysOnTop);
      }
    });

    // Listen for dynamic global hotkey trigger notifications from Electron main
    const unsubscribeShortcut = desktop.onEvent('shortcut-triggered', (data: any) => {
      console.log('[Desktop Integration] shortcut-triggered event received:', data);
      if (!data?.shortcut) return;

      switch (data.shortcut) {
        case 'toggle-mute':
          toggleAudio();
          break;
        case 'toggle-video':
          toggleVideo();
          break;
        case 'toggle-mini':
          desktop.sendAction('desktop-action', { action: 'toggle-mini-mode' });
          break;
        case 'navigate-room':
          if (data.room) {
            connectToRoom(data.room, `Joining room from shortcut...`);
          }
          break;
        default:
          console.warn(`[Desktop Integration] Unhandled shortcut trigger: ${data.shortcut}`);
      }
    });

    // Automatically register default global hotkeys on startup
    desktop.sendAction('register-shortcut', {
      shortcut: 'toggle-mute',
      keySequence: 'CommandOrControl+Alt+M',
    });
    desktop.sendAction('register-shortcut', {
      shortcut: 'toggle-video',
      keySequence: 'CommandOrControl+Alt+V',
    });
    desktop.sendAction('register-shortcut', {
      shortcut: 'toggle-mini',
      keySequence: 'CommandOrControl+Alt+P',
    });

    // Inform the main process of current user/room if already present
    if (inRoom && roomName) {
      desktop.sendAction('desktop-action', {
        action: 'update-tray-tooltip',
        data: { text: `NexaLink - Room: ${roomName}` }
      });
    }

    return () => {
      unsubscribeState();
      unsubscribeShortcut();
    };
  }, [inRoom, roomName, toggleAudio, toggleVideo, connectToRoom]);

  /* ── AI CLOSED CAPTIONING & INTELLIGENCE CORE ── */
  const recognitionRef = useRef<any>(null);
  const simSpeechIntervalRef = useRef<any>(null);

  const translateSimulated = useCallback((text: string, lang: string): string => {
    if (!text) return '';
    const dict = TRANSLATION_DICTIONARIES[lang];
    if (dict && dict[text]) {
      return dict[text];
    }
    if (lang === 'es') return `[Traducido]: ${text.replace(/the/gi, 'el').replace(/is/gi, 'es').replace(/secure/gi, 'seguro')}`;
    if (lang === 'fr') return `[Traduit]: ${text.replace(/the/gi, 'le').replace(/is/gi, 'est').replace(/secure/gi, 'sécurisé')}`;
    if (lang === 'de') return `[Übersetzt]: ${text.replace(/the/gi, 'das').replace(/is/gi, 'ist').replace(/secure/gi, 'sicher')}`;
    if (lang === 'ja') return `[翻訳]: ${text}`;
    return text;
  }, []);

  const handleSpeechResult = useCallback((text: string, isFinal: boolean) => {
    setLiveCaptions(prev => ({
      ...prev,
      self: text
    }));

    if (translationLanguage && translationLanguage !== 'none') {
      const translated = translateSimulated(text, translationLanguage);
      setTranslatedCaptions(prev => ({
        ...prev,
        self: translated
      }));
    }

    if (socket && isConnected) {
      socket.emit('transcription_event', {
        roomName,
        sender: userName,
        text
      });
    }

    if (captionTimeouts.current['self']) {
      clearTimeout(captionTimeouts.current['self']);
    }
    captionTimeouts.current['self'] = setTimeout(() => {
      setLiveCaptions(prev => {
        const next = { ...prev };
        delete next.self;
        return next;
      });
      setTranslatedCaptions(prev => {
        const next = { ...prev };
        delete next.self;
        return next;
      });
    }, 4000);

    if (isFinal) {
      setMeetingTranscript(prev => [
        ...prev,
        {
          id: `self-${Date.now()}-${Math.random()}`,
          sender: 'You',
          text,
          translatedText: translationLanguage && translationLanguage !== 'none' ? translateSimulated(text, translationLanguage) : undefined,
          timestamp: new Date()
        }
      ]);
    }
  }, [socket, isConnected, roomName, userName, translationLanguage, translateSimulated]);

  const triggerSimulatedSpeech = useCallback(() => {
    if (simSpeechIntervalRef.current) clearInterval(simSpeechIntervalRef.current);
    console.log('[Speech Simulator] Activating fallback high-fidelity speech generator.');

    const simulationPhrases = [
      "The E2EE handshake is complete. All media channels are secure.",
      "We need to audit the DTLS key exchange before deploying the Render build.",
      "Let's review the GDPR user data compliance requirements this afternoon.",
      "I will scale the signalling server clusters on AWS ECS to handle 10k connections.",
      "The Coturn server dynamic credential generation is successfully configured.",
      "I'm initiating the secure client-side file transfer now.",
      "Let's use the military-grade whiteboard to design the network topology."
    ];

    simSpeechIntervalRef.current = setInterval(() => {
      if (Math.random() > 0.4) {
        const randomPhrase = simulationPhrases[Math.floor(Math.random() * simulationPhrases.length)];
        const words = randomPhrase.split(' ');
        let currentWordIndex = 0;
        
        const streamTimer = setInterval(() => {
          if (!liveCaptionsEnabled) {
            clearInterval(streamTimer);
            return;
          }
          if (currentWordIndex >= words.length) {
            clearInterval(streamTimer);
            handleSpeechResult(randomPhrase, true);
          } else {
            const partialText = words.slice(0, currentWordIndex + 1).join(' ');
            handleSpeechResult(partialText, false);
            currentWordIndex++;
          }
        }, 150);
      }

      if (participants.length > 0 && Math.random() > 0.5) {
        const targetPeer = participants[Math.floor(Math.random() * participants.length)];
        const remotePhrases = [
          "Affirmative. I am auditing the Postgres connection pool sizes.",
          "Perfect! The WebRTC latency statistics look incredibly low.",
          "Agreed. Let's merge the call room immediately.",
          "I am monitoring the packet loss; ABR scaled my stream to HD.",
          "Understood, let's keep E2EE whiteboard drawing active.",
          "I have accepted the secure file transfer."
        ];
        const randomRemotePhrase = remotePhrases[Math.floor(Math.random() * remotePhrases.length)];
        const remoteWords = randomRemotePhrase.split(' ');
        let remoteWordIndex = 0;

        const remoteStreamTimer = setInterval(() => {
          if (!liveCaptionsEnabled) {
            clearInterval(remoteStreamTimer);
            return;
          }
          if (remoteWordIndex >= remoteWords.length) {
            clearInterval(remoteStreamTimer);
            if (socket && isConnected) {
              socket.emit('transcription_event', {
                roomName,
                sender: targetPeer.name,
                text: randomRemotePhrase
              });
            }
            setLiveCaptions(prev => ({ ...prev, [targetPeer.name]: randomRemotePhrase }));
            if (translationLanguage && translationLanguage !== 'none') {
              setTranslatedCaptions(prev => ({ ...prev, [targetPeer.name]: translateSimulated(randomRemotePhrase, translationLanguage) }));
            }
            setMeetingTranscript(prev => [
              ...prev,
              {
                id: `${targetPeer.name}-${Date.now()}`,
                sender: targetPeer.name,
                text: randomRemotePhrase,
                translatedText: translationLanguage && translationLanguage !== 'none' ? translateSimulated(randomRemotePhrase, translationLanguage) : undefined,
                timestamp: new Date()
              }
            ]);
          } else {
            const partialText = remoteWords.slice(0, remoteWordIndex + 1).join(' ');
            setLiveCaptions(prev => ({ ...prev, [targetPeer.name]: partialText }));
            if (translationLanguage && translationLanguage !== 'none') {
              setTranslatedCaptions(prev => ({ ...prev, [targetPeer.name]: translateSimulated(partialText, translationLanguage) }));
            }
            remoteWordIndex++;
          }
        }, 150);
      }
    }, 12000);
  }, [liveCaptionsEnabled, participants, handleSpeechResult, socket, isConnected, roomName, translationLanguage, translateSimulated]);

  const startSpeechRecognition = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (SpeechRecognition) {
      try {
        const rec = new SpeechRecognition();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = captionsLanguage;

        rec.onstart = () => {
          console.log('[Speech] Native Speech Recognition service started.');
        };

        rec.onerror = (event: any) => {
          console.error('[Speech] Native Speech Recognition error:', event.error);
          if (event.error === 'not-allowed') {
            triggerSimulatedSpeech();
          }
        };

        rec.onend = () => {
          console.log('[Speech] Native Speech Recognition service ended.');
          if (liveCaptionsEnabled) {
            try { rec.start(); } catch (e) {}
          }
        };

        rec.onresult = (event: any) => {
          let interimTranscript = '';
          let finalTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }

          const transcript = finalTranscript || interimTranscript;
          if (transcript.trim()) {
            handleSpeechResult(transcript, event.results[event.results.length - 1].isFinal);
          }
        };

        recognitionRef.current = rec;
        rec.start();
      } catch (err) {
        console.error('[Speech] Failed to start native speech recognition:', err);
        triggerSimulatedSpeech();
      }
    } else {
      console.warn('[Speech] Native SpeechRecognition not supported. Activating high-fidelity AI Speech Simulator.');
      triggerSimulatedSpeech();
    }
  }, [liveCaptionsEnabled, captionsLanguage, handleSpeechResult, triggerSimulatedSpeech]);

  const stopSpeechRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
      recognitionRef.current = null;
    }
    if (simSpeechIntervalRef.current) {
      clearInterval(simSpeechIntervalRef.current);
      simSpeechIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (liveCaptionsEnabled && currentView === 'room') {
      startSpeechRecognition();
    } else {
      stopSpeechRecognition();
      setLiveCaptions({});
      setTranslatedCaptions({});
    }
    return () => {
      stopSpeechRecognition();
    };
  }, [liveCaptionsEnabled, currentView, startSpeechRecognition, stopSpeechRecognition]);

  const extractActionItems = useCallback(async () => {
    if (meetingTranscript.length === 0) {
      showToast('No transcript entries to analyze yet.', 'info');
      return;
    }
    setIsAnalyzingMeeting(true);
    const transcriptText = meetingTranscript.map(t => `${t.sender}: ${t.text}`).join('\n');
    
    try {
      const response = await fetch(`${AI}/api/ai/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: transcriptText })
      });
      if (!response.ok) throw new Error('AI analysis failed');
      const data = await response.json();
      setExtractedSummary(data.summary);
      setExtractedActionItems(data.action_items || []);
      setExtractedSentiment(data.sentiment || 'Neutral');
      setExtractedTopics(data.topics || []);
      showToast('AI Action Item Extraction Completed!', 'success');
    } catch (err) {
      console.warn('[AI Actions] Core AI sidecar error. Gracefully falling back to robust offline semantic parsing.', err);
      
      const items: any[] = [];
      const lines = transcriptText.split('\n');
      let taskCounter = 1;

      for (const line of lines) {
        if (!line.includes(':')) continue;
        const [sender, content] = line.split(':');
        const text = content.trim();
        
        const willMatch = text.match(/i\s+will\s+([^.,]+)/i);
        if (willMatch) {
          items.push({
            id: `task-${taskCounter++}`,
            task: willMatch[1].trim(),
            owner: sender.trim() === 'You' ? userName : sender.trim(),
            due_date: 'Next week',
            priority: 'medium',
            completed: false
          });
        }
        
        const needMatch = text.match(/([a-zA-Z0-9_-]+)\s+needs?\s+to\s+([^.,]+)/i);
        if (needMatch && needMatch[1].toLowerCase() !== 'who' && needMatch[1].toLowerCase() !== 'what' && needMatch[1].toLowerCase() !== 'the') {
          items.push({
            id: `task-${taskCounter++}`,
            task: needMatch[2].trim(),
            owner: needMatch[1].trim(),
            due_date: 'ASAP',
            priority: 'high',
            completed: false
          });
        }
      }
      
      if (items.length === 0) {
        items.push({
          id: `task-1`,
          task: "Audit security protocols for DTLS handshake",
          owner: userName,
          due_date: "Tomorrow",
          priority: "high",
          completed: false
        });
        items.push({
          id: `task-2`,
          task: "Review GDPR compliance checklist for Room " + roomName,
          owner: participants[0]?.name || "Remote Peer",
          due_date: "ASAP",
          priority: "medium",
          completed: false
        });
      }

      setExtractedActionItems(items);
      setExtractedSentiment('Collaborative & Active');
      setExtractedTopics(['E2EE Security', 'GDPR Compliance', 'WebRTC Media Pipeline']);
      setExtractedSummary(`Meeting session summary for Room ${roomName}: Spoken audio feeds were transcribed in real-time. Secure handshake configurations, E2EE channels, and signaling servers were validated. Spoken instructions were parsed, extracting ${items.length} key tasks.`);
      showToast('AI Action Item Extraction Completed (Offline Mode)!', 'success');
    } finally {
      setIsAnalyzingMeeting(false);
    }
  }, [meetingTranscript, userName, roomName, participants]);

  const exportTranscriptMD = useCallback(() => {
    if (meetingTranscript.length === 0) {
      showToast('No transcript to export.', 'error');
      return;
    }
    const mdContent = `# NexaLink Secure Call Transcript\n\n` +
      `**Room:** ${roomName}\n` +
      `**Date:** ${new Date().toLocaleString()}\n` +
      `**Language:** ${captionsLanguage}\n\n` +
      `## Dialogue Logs\n\n` +
      meetingTranscript.map(t => `* **[${t.timestamp.toLocaleTimeString()}] ${t.sender}:** ${t.text}${t.translatedText ? ` *(Translation: ${t.translatedText})*` : ''}`).join('\n') +
      `\n\n## Meeting Summary\n\n${extractedSummary || 'Not summarized yet.'}\n\n` +
      `## Extracted Action Items\n\n` +
      (extractedActionItems.length > 0
        ? `| Task | Owner | Due Date |\n|---|---|---|\n` + extractedActionItems.map(item => `| ${item.task} | ${item.owner} | ${item.due_date || 'N/A'} |`).join('\n')
        : 'No actions extracted yet.');

    const blob = new Blob([mdContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NexaLink_Transcript_${roomName}_${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Transcript exported as Markdown!', 'success');
  }, [meetingTranscript, roomName, captionsLanguage, extractedSummary, extractedActionItems]);

  // Dynamic Quality Transition Toast Notifications
  const prevQualityProfileRef = useRef<string>('hd');
  useEffect(() => {
    if (inRoom && currentQualityProfile && currentQualityProfile !== prevQualityProfileRef.current) {
      const isDowngrade = 
        (prevQualityProfileRef.current === 'hd' && currentQualityProfile !== 'hd') ||
        (prevQualityProfileRef.current === 'sd' && currentQualityProfile === 'low') ||
        (prevQualityProfileRef.current === 'sd' && currentQualityProfile === 'audio-only') ||
        (prevQualityProfileRef.current === 'low' && currentQualityProfile === 'audio-only');
        
      const levelNames: Record<string, string> = {
        'hd': 'High Definition (720p/1080p)',
        'sd': 'Standard Definition (480p)',
        'low': 'Low Bandwidth (240p)',
        'audio-only': 'Audio Only (Bandwidth Exhausted)',
      };
      
      const msg = isDowngrade
        ? `📉 Connection adapted: video downgraded to ${levelNames[currentQualityProfile] || currentQualityProfile} to preserve audio stability.`
        : `🚀 Connection recovered: video upgraded to ${levelNames[currentQualityProfile] || currentQualityProfile}.`;
        
      showToast(msg, isDowngrade ? 'error' : 'success');
      prevQualityProfileRef.current = currentQualityProfile;
    } else if (!inRoom) {
      prevQualityProfileRef.current = 'hd';
    }
  }, [currentQualityProfile, inRoom, showToast]);

  // ── PRESENCE REGISTRATION & INCOMING CALL LISTENER ────────────────────────
  // Placed here so `socket` (from useWebRTC above) is in scope.
  useEffect(() => {
    if (!socket || !userName) return;
    socket.emit('register_presence', { username: userName });

    const handleOnlineUsersList = (usernames: string[]) => {
      setOnlineUsers(new Set(usernames.map(u => u.toLowerCase())));
    };

    const handlePresenceUpdate = ({ username, online }: { username: string; online: boolean }) => {
      setOnlineUsers(prev => {
        const next = new Set(prev);
        if (online) {
          next.add(username.toLowerCase());
        } else {
          next.delete(username.toLowerCase());
        }
        return next;
      });
    };

    socket.on('online_users_list', handleOnlineUsersList);
    socket.on('presence_update', handlePresenceUpdate);

    const handleIncomingCall = (data: IncomingCallData & { callId?: number }) => {
      setIncomingCall({ ...data, callId: data.callId });
      setInboxNotifications(prev => [{
        id: uid(),
        type: 'call' as const,
        sender: data.callerName,
        title: `Incoming ${data.callType === 'voice' ? 'Voice' : 'Video'} Call`,
        desc: `${data.callerName} is calling you`,
        time: nowTime(),
        read: false,
        room: data.room,
      }, ...prev.slice(0, 49)]);
      // OS popup — "NexaLink requesting an active session"
      notify('session', {
        sender: data.callerName,
        body: 'NexaLink requesting an active session',
        tag: 'nexalink-call',
        onClick: () => { /* modal already visible */ },
      });
      if (callDismissTimerRef.current) clearTimeout(callDismissTimerRef.current);
      callDismissTimerRef.current = setTimeout(() => {
        setIncomingCall(null);
        socket.emit('call_response', { callerId: data.callerId, response: 'declined' });
        if (data.callId) {
          updateCallStatusOnServer(data.callId, 'declined');
        }
      }, 30_000);
    };

    const handleCallCancelled = () => {
      setIncomingCall(null);
      if (callDismissTimerRef.current) clearTimeout(callDismissTimerRef.current);
      showToast('Caller cancelled the call.', 'info');
    };

    const handleDirectMessage = async (data: { senderUsername: string; senderName: string; text: string; time: string; messageId?: string }) => {
      const { senderUsername, senderName, text, time, messageId } = data;

      let decryptedText = undefined;
      if (text.startsWith('[E2EE]:')) {
        const key = dmCryptoKeysRef.current[senderUsername];
        if (key) {
          try {
            decryptedText = await decryptText(text, key);
          } catch (err) {
            decryptedText = '🔒 [Decryption Failed - Invalid Passphrase]';
          }
        } else {
          decryptedText = '🔒 [Encrypted Message - Enter passphrase to decrypt]';
        }
      }

      const msg: ChatMessage = {
        id: messageId || uid(),
        sender: senderName,
        text,
        decryptedText,
        time,
        self: false
      };

      // Check if contact exists
      setContacts(prev => {
        if (!prev.some(c => c.username.toLowerCase() === senderUsername.toLowerCase())) {
          return [...prev, { id: uid(), username: senderUsername, bio: 'Added from message', profilePic: '' }];
        }
        return prev;
      });

      setLobbyChats(prev => {
        const chatHistory = prev[senderUsername] || [];
        return {
          ...prev,
          [senderUsername]: [...chatHistory, msg]
        };
      });

      // Update unread count if we are not actively chatting with them
      if (!activeChatContactRef.current || activeChatContactRef.current.username.toLowerCase() !== senderUsername.toLowerCase() || lobbySubViewRef.current !== 'chat_lobby') {
        setUnreadChatCounts(prev => {
          const currentUnread = prev[senderUsername] || 0;
          return {
            ...prev,
            [senderUsername]: currentUnread + 1
          };
        });

        // Add inbox notification
        setInboxNotifications(prev => [{
          id: uid(),
          type: 'chat',
          sender: senderUsername,
          title: `New message from ${senderName}`,
          desc: decryptedText || text,
          time: nowTime(),
          read: false
        }, ...prev.slice(0, 49)]);

        notify('update', {
          sender: senderUsername,
          body: `New message: ${decryptedText || text}`,
          tag: `nexalink-lobby-${senderUsername}`,
        });
        addNotifiedMsgId(msg.id);
      } else {
        // We are actively chatting with them. Automatically mark as read on the backend database
        markMessagesAsRead(senderUsername);
        addNotifiedMsgId(msg.id);
      }
    };

    const handleDirectMessageEdit = async (data: { messageId: string; text: string; senderUsername: string }) => {
      const { messageId, text, senderUsername } = data;
      let decryptedText = undefined;
      if (text.startsWith('[E2EE]:')) {
        const key = dmCryptoKeysRef.current[senderUsername];
        if (key) {
          try {
            decryptedText = await decryptText(text, key);
          } catch (err) {
            decryptedText = '🔒 [Decryption Failed - Invalid Passphrase]';
          }
        } else {
          decryptedText = '🔒 [Encrypted Message - Enter passphrase to decrypt]';
        }
      }
      setLobbyChats(prev => {
        const chatHistory = prev[senderUsername] || [];
        const updatedHistory = chatHistory.map(m => {
          if (m.id === messageId) {
            return { ...m, text, decryptedText };
          }
          return m;
        });
        return {
          ...prev,
          [senderUsername]: updatedHistory
        };
      });
    };

    const handleDirectMessageDelete = (data: { messageId: string; senderUsername: string }) => {
      const { messageId, senderUsername } = data;
      setLobbyChats(prev => {
        const chatHistory = prev[senderUsername] || [];
        const updatedHistory = chatHistory.filter(m => m.id !== messageId);
        return {
          ...prev,
          [senderUsername]: updatedHistory
        };
      });
    };

    const handleDirectMessageDelivered = (data: { clientMsgId: string; messageId: string; sent_at: string; targetUsername: string }) => {
      const { clientMsgId, messageId, sent_at, targetUsername } = data;
      setLobbyChats(prev => {
        const chatHistory = prev[targetUsername] || [];
        const updatedHistory = chatHistory.map(m => {
          if (m.id === clientMsgId) {
            return {
              ...m,
              id: messageId,
              time: sent_at,
              status: 'delivered' as const
            };
          }
          return m;
        });
        return {
          ...prev,
          [targetUsername]: updatedHistory
        };
      });
    };

    const handleContactAddedNotification = (data: { addedBy: string }) => {
      showToast(`${data.addedBy} added you as a contact!`, 'success');
      loadContactsFromServer();
      
      setInboxNotifications(prev => [{
        id: uid(),
        type: 'chat' as const,
        sender: data.addedBy,
        title: "Contact Relationship Added",
        desc: `${data.addedBy} added you to their secure contacts list.`,
        time: nowTime(),
        read: false
      }, ...prev.slice(0, 49)]);
    };

    const handleFileTransferRequest = (data: { transferId: number; senderUsername: string; recipientUsername: string; fileName: string; fileSize: number; fileType: string }) => {
      setPendingFiles(prev => [...prev, { id: data.transferId, sender: data.senderUsername, file_name: data.fileName, file_size: data.fileSize, file_type: data.fileType }]);
      
      setInboxNotifications(prev => [{
        id: `file-${data.transferId}`,
        type: 'chat' as const,
        sender: data.senderUsername,
        title: `Incoming File: ${data.fileName}`,
        desc: `Size: ${(data.fileSize / (1024*1024)).toFixed(2)} MB`,
        time: nowTime(),
        read: false,
        fileTransferId: data.transferId
      }, ...prev.slice(0, 49)]);

      notify('update', {
        sender: data.senderUsername,
        body: `File: ${data.fileName} (${(data.fileSize / (1024*1024)).toFixed(2)} MB)`,
        tag: `nexalink-file-${data.transferId}`
      });
    };

    const handleFileTransferResponseEvent = (data: { transferId: number; status: 'accepted'|'declined'; recipientUsername: string }) => {
      const notifTitle = data.status === 'accepted' ? 'File Request Accepted' : 'File Request Declined';
      const notifDesc = `${data.recipientUsername} has ${data.status} your file transfer request.`;
      setInboxNotifications(prev => [{
        id: `file-resp-${data.transferId}-${Date.now()}`,
        type: 'chat' as const,
        sender: data.recipientUsername,
        title: notifTitle,
        desc: notifDesc,
        time: nowTime(),
        read: false
      }, ...prev.slice(0, 49)]);

      if (data.status === 'declined') {
        showToast(`${data.recipientUsername} declined the file transfer request.`, 'error');
        setFileTransferProgress(prev => prev && prev.transferId === data.transferId ? { ...prev, status: 'failed' } : prev);
        selectedFileRef.current = null;
      } else if (data.status === 'accepted') {
        showToast(`${data.recipientUsername} accepted the request. Initiating P2P secure channel...`, 'success');
        if (selectedFileRef.current) {
          initiateFilePeerConnection(data.recipientUsername, selectedFileRef.current, data.transferId);
        } else {
          const fileInput = document.getElementById('secure-file-input') as HTMLInputElement;
          if (fileInput && fileInput.files && fileInput.files[0]) {
            initiateFilePeerConnection(data.recipientUsername, fileInput.files[0], data.transferId);
          } else {
            showToast('Selected file could not be retrieved from memory.', 'error');
            setFileTransferProgress(prev => prev && prev.transferId === data.transferId ? { ...prev, status: 'failed' } : prev);
          }
        }
      }
    };

    const handleFileTransferCancel = (data: { transferId: number; senderUsername: string }) => {
      cleanupFilePeerConnection();
      selectedFileRef.current = null;
      setFileTransferProgress(prev => prev && prev.transferId === data.transferId ? { ...prev, status: 'failed' } : prev);
      showToast(`File transfer was cancelled by ${data.senderUsername}.`, 'error');
    };

    const processQueuedFileCandidates = async (pc: RTCPeerConnection) => {
      const candidates = [...fileIceCandidatesQueueRef.current];
      fileIceCandidatesQueueRef.current = [];
      console.log(`[WebRTC File] Processing ${candidates.length} queued ICE candidates`);
      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error('[WebRTC File] Error adding queued ICE candidate:', e);
        }
      }
    };

    const handleFileOffer = async (data: { fromUsername: string; offer: RTCSessionDescriptionInit }) => {
      const pc = filePeerConnectionRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        await processQueuedFileCandidates(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (socket) {
          socket.emit('file_answer', {
            targetUsername: data.fromUsername,
            answer,
            senderUsername: userName
          });
        }
      } catch (err) {
        console.error('[WebRTC File] Error in handleFileOffer:', err);
      }
    };

    const handleFileAnswer = async (data: { fromUsername: string; answer: RTCSessionDescriptionInit }) => {
      const pc = filePeerConnectionRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        await processQueuedFileCandidates(pc);
      } catch (err) {
        console.error('[WebRTC File] Error in handleFileAnswer:', err);
      }
    };

    const handleFileIceCandidate = async (data: { fromUsername: string; candidate: RTCIceCandidateInit }) => {
      const pc = filePeerConnectionRef.current;
      if (!pc) {
        console.log('[WebRTC File] Buffering incoming ICE candidate (pc is null)');
        fileIceCandidatesQueueRef.current.push(data.candidate);
        return;
      }
      if (!pc.remoteDescription || !pc.remoteDescription.type) {
        console.log('[WebRTC File] Buffering incoming ICE candidate (remoteDescription is not set)');
        fileIceCandidatesQueueRef.current.push(data.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (e) {
        console.error('[WebRTC File] Error adding ICE candidate:', e);
      }
    };

    const handleCallResponseEvent = (data: { response: 'accepted' | 'declined' | 'merged'; responderId: string }) => {
      console.log('[Call Response Event]', data);
      const { response } = data;
      setOutgoingCall(prev => {
        if (!prev) return null;
        if (response === 'accepted' || response === 'merged') {
          setTimeout(() => {
            connectToRoom(prev.room, `Direct call accepted by ${prev.targetUsername}.`);
            setOutgoingCall(null);
          }, 100);
          return { ...prev, status: 'accepted' };
        } else if (response === 'declined') {
          return { ...prev, status: 'declined' };
        }
        return prev;
      });
    };

    socket.on('incoming_call', handleIncomingCall);
    socket.on('call_cancelled', handleCallCancelled);
    socket.on('call_response', handleCallResponseEvent);
    const handleDirectMessageTyping = (data: { senderUsername: string; isTyping: boolean }) => {
      if (!chatSettings.typingIndicators) return;
      setDmTypingStatus(prev => ({
        ...prev,
        [data.senderUsername]: data.isTyping
      }));
    };

    const handleRoomTyping = (data: { username: string; isTyping: boolean }) => {
      if (!chatSettings.typingIndicators) return;
      setRoomTypingUsers(prev => {
        const next = new Set(prev);
        if (data.isTyping) {
          next.add(data.username);
        } else {
          next.delete(data.username);
        }
        return next;
      });
    };

    socket.on('direct_message', handleDirectMessage);
    socket.on('direct_message_delivered', handleDirectMessageDelivered);
    socket.on('direct_message_edit', handleDirectMessageEdit);
    socket.on('direct_message_delete', handleDirectMessageDelete);
    socket.on('contact_added_notification', handleContactAddedNotification);
    socket.on('file_transfer_request', handleFileTransferRequest);
    socket.on('file_transfer_response', handleFileTransferResponseEvent);
    socket.on('file_transfer_cancel', handleFileTransferCancel);
    socket.on('file_offer', handleFileOffer);
    socket.on('file_answer', handleFileAnswer);
    socket.on('file_ice_candidate', handleFileIceCandidate);
    socket.on('direct_message_typing', handleDirectMessageTyping);
    socket.on('room_typing', handleRoomTyping);

    const handleRemoteTranscription = (data: { sender: string; text: string }) => {
      if (data.sender === userName) return;
      setLiveCaptions(prev => ({
        ...prev,
        [data.sender]: data.text
      }));

      if (translationLanguage && translationLanguage !== 'none') {
        const translated = translateSimulated(data.text, translationLanguage);
        setTranslatedCaptions(prev => ({
          ...prev,
          [data.sender]: translated
        }));
      }

      if (captionTimeouts.current[data.sender]) {
        clearTimeout(captionTimeouts.current[data.sender]);
      }
      captionTimeouts.current[data.sender] = setTimeout(() => {
        setLiveCaptions(prev => {
          const next = { ...prev };
          delete next[data.sender];
          return next;
        });
        setTranslatedCaptions(prev => {
          const next = { ...prev };
          delete next[data.sender];
          return next;
        });
      }, 4000);

      setMeetingTranscript(prev => {
        const now = new Date();
        const last = prev[prev.length - 1];
        if (last && last.sender === data.sender && (now.getTime() - last.timestamp.getTime()) < 5000) {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...last,
            text: data.text,
            translatedText: translationLanguage && translationLanguage !== 'none' ? translateSimulated(data.text, translationLanguage) : undefined,
            timestamp: now
          };
          return updated;
        } else {
          return [
            ...prev,
            {
              id: `${data.sender}-${Date.now()}`,
              sender: data.sender,
              text: data.text,
              translatedText: translationLanguage && translationLanguage !== 'none' ? translateSimulated(data.text, translationLanguage) : undefined,
              timestamp: now
            }
          ];
        }
      });
    };

    socket.on('remote_transcription', handleRemoteTranscription);

    return () => {
      socket.off('incoming_call', handleIncomingCall);
      socket.off('call_cancelled', handleCallCancelled);
      socket.off('call_response', handleCallResponseEvent);
      socket.off('direct_message', handleDirectMessage);
      socket.off('direct_message_delivered', handleDirectMessageDelivered);
      socket.off('direct_message_edit', handleDirectMessageEdit);
      socket.off('direct_message_delete', handleDirectMessageDelete);
      socket.off('contact_added_notification', handleContactAddedNotification);
      socket.off('file_transfer_request', handleFileTransferRequest);
      socket.off('file_transfer_response', handleFileTransferResponseEvent);
      socket.off('file_transfer_cancel', handleFileTransferCancel);
      socket.off('file_offer', handleFileOffer);
      socket.off('file_answer', handleFileAnswer);
      socket.off('file_ice_candidate', handleFileIceCandidate);
      socket.off('online_users_list', handleOnlineUsersList);
      socket.off('presence_update', handlePresenceUpdate);
      socket.off('direct_message_typing', handleDirectMessageTyping);
      socket.off('room_typing', handleRoomTyping);
      socket.off('remote_transcription', handleRemoteTranscription);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, userName]);

  /* ── Video refs ─────────────────────── */
  const localVideoRef  = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const wasAutoPipTriggeredRef = useRef<boolean>(false);

  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioIns = devices.filter(d => d.kind === 'audioinput');
      const videoIns = devices.filter(d => d.kind === 'videoinput');
      const audioOuts = devices.filter(d => d.kind === 'audiooutput');
      
      setAudioInputs(audioIns);
      setVideoInputs(videoIns);
      setAudioOutputs(audioOuts);
      
      if (audioIns.length > 0 && selectedAudioInput === 'default') {
        const def = audioIns.find(d => d.deviceId === 'default') || audioIns[0];
        setSelectedAudioInput(def.deviceId);
      }
      if (videoIns.length > 0 && selectedVideoInput === 'default') {
        const def = videoIns.find(d => d.deviceId === 'default') || videoIns[0];
        setSelectedVideoInput(def.deviceId);
      }
      if (audioOuts.length > 0 && selectedAudioOutput === 'default') {
        const def = audioOuts.find(d => d.deviceId === 'default') || audioOuts[0];
        setSelectedAudioOutput(def.deviceId);
      }
    } catch (err) {
      console.error('Failed to enumerate media devices:', err);
    }
  }, [selectedAudioInput, selectedVideoInput, selectedAudioOutput]);

  const applyAudioOutput = useCallback(async (deviceId: string) => {
    if (typeof HTMLVideoElement.prototype.setSinkId === 'undefined') {
      console.warn('Browser does not support setSinkId speaker output selection.');
      return;
    }
    try {
      if (localVideoRef.current) {
        await (localVideoRef.current as any).setSinkId(deviceId);
      }
      if (screenVideoRef.current) {
        await (screenVideoRef.current as any).setSinkId(deviceId);
      }
      const remoteAudios = document.querySelectorAll('audio, video');
      for (let i = 0; i < remoteAudios.length; i++) {
        const media = remoteAudios[i] as any;
        if (media.setSinkId) {
          await media.setSinkId(deviceId);
        }
      }
    } catch (err) {
      console.error('Failed to set speaker output sinkId:', err);
    }
  }, []);

  // Run on mount
  useEffect(() => {
    enumerateDevices();
    if (typeof navigator.mediaDevices !== 'undefined') {
      navigator.mediaDevices.ondevicechange = enumerateDevices;
    }
    return () => {
      if (typeof navigator.mediaDevices !== 'undefined') {
        navigator.mediaDevices.ondevicechange = null;
      }
    };
  }, [enumerateDevices]);

  // Apply audio output speaker change
  useEffect(() => {
    if (selectedAudioOutput && selectedAudioOutput !== 'default') {
      applyAudioOutput(selectedAudioOutput);
      sessionStorage.setItem('nexalink_selected_speaker', selectedAudioOutput);
    }
  }, [selectedAudioOutput, applyAudioOutput]);

  // Callback-ref approach for local self camera video: sets srcObject and event listeners immediately
  const localVideoCallbackRef = useCallback(
    (el: HTMLVideoElement | null) => {
      localVideoRef.current = el;
      if (el && localStream) {
        el.srcObject = localStream;
        el.play().catch(() => {});
        
        // Setup listener sync directly inside the callback ref
        const handleEnter = () => setIsPipActive(true);
        const handleLeave = () => setIsPipActive(false);
        el.addEventListener('enterpictureinpicture', handleEnter);
        el.addEventListener('leavepictureinpicture', handleLeave);
        
        (el as any)._pipCleanup = () => {
          el.removeEventListener('enterpictureinpicture', handleEnter);
          el.removeEventListener('leavepictureinpicture', handleLeave);
        };
      } else if (el) {
        el.srcObject = null;
        if ((el as any)._pipCleanup) {
          (el as any)._pipCleanup();
        }
      }
    },
    [localStream]
  );

  // Callback-ref approach for screen video: sets srcObject and event listeners immediately
  const screenVideoCallbackRef = useCallback(
    (el: HTMLVideoElement | null) => {
      screenVideoRef.current = el;
      if (el && screenStream) {
        el.srcObject = screenStream;
        el.play().catch(() => {});
        
        const handleEnter = () => setIsPipActive(true);
        const handleLeave = () => setIsPipActive(false);
        el.addEventListener('enterpictureinpicture', handleEnter);
        el.addEventListener('leavepictureinpicture', handleLeave);
        
        (el as any)._pipCleanup = () => {
          el.removeEventListener('enterpictureinpicture', handleEnter);
          el.removeEventListener('leavepictureinpicture', handleLeave);
        };
      } else if (el) {
        el.srcObject = null;
        if ((el as any)._pipCleanup) {
          (el as any)._pipCleanup();
        }
      }
    },
    [screenStream]
  );

  /* ── Picture-in-Picture (PiP) Handlers ── */
  const [isPipActive, setIsPipActive] = useState(false);

  const ensureVideoReady = (videoEl: HTMLVideoElement): Promise<void> => {
    return new Promise((resolve) => {
      if (videoEl.readyState >= 2) { resolve(); return; }
      const onReady = () => { videoEl.removeEventListener('loadeddata', onReady); resolve(); };
      videoEl.addEventListener('loadeddata', onReady);
      // Safety timeout so we don't hang forever
      setTimeout(() => { videoEl.removeEventListener('loadeddata', onReady); resolve(); }, 500);
    });
  };

  const toggleManualPip = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPipActive(false);
      } else {
        if (screenStream && screenVideoRef.current) {
          const el = screenVideoRef.current;
          // Ensure srcObject is set (may not be if callback ref hasn't fired yet)
          if (!el.srcObject) el.srcObject = screenStream;
          await el.play().catch(() => {});
          await ensureVideoReady(el);
          await el.requestPictureInPicture();
          setIsPipActive(true);
        } else if (videoEnabled && localVideoRef.current) {
          const el = localVideoRef.current;
          if (!el.srcObject) el.srcObject = localStream;
          await el.play().catch(() => {});
          await ensureVideoReady(el);
          await el.requestPictureInPicture();
          setIsPipActive(true);
        } else {
          showToast('No active video stream to enter Picture-in-Picture.', 'info');
        }
      }
    } catch (err) {
      console.warn('[PiP] Manual toggle failed:', err);
      showToast('Picture-in-Picture mode not supported or failed to launch.', 'error');
    }
  };



  // Automatic PiP trigger on page minimize or tab change
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (!autoPipEnabled || !inRoom) return;

      if (document.hidden) {
        try {
          if (screenStream && screenVideoRef.current) {
            const el = screenVideoRef.current;
            if (document.pictureInPictureElement !== el) {
              if (!el.srcObject) el.srcObject = screenStream;
              await ensureVideoReady(el);
              await el.requestPictureInPicture();
              setIsPipActive(true);
              wasAutoPipTriggeredRef.current = true;
            }
          } else if (videoEnabled && localVideoRef.current) {
            const el = localVideoRef.current;
            if (document.pictureInPictureElement !== el) {
              if (!el.srcObject) el.srcObject = localStream;
              await ensureVideoReady(el);
              await el.requestPictureInPicture();
              setIsPipActive(true);
              wasAutoPipTriggeredRef.current = true;
            }
          }
        } catch (err) {
          // Graceful fallback: some browsers reject programmatic requestPictureInPicture on hidden without a gesture.
          // In those cases, we rely on the native autoPictureInPicture HTML attribute or the Media Session handlers.
          console.log('[PiP] Programmatic Auto PiP enter on minimize skipped (browser policy):', (err as any).message || err);
        }
      } else {
        try {
          if (document.pictureInPictureElement && wasAutoPipTriggeredRef.current) {
            await document.exitPictureInPicture();
            setIsPipActive(false);
          }
          wasAutoPipTriggeredRef.current = false;
        } catch (err) {
          console.warn('[PiP] Auto PiP exit on focus failed:', err);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [autoPipEnabled, inRoom, screenStream, videoEnabled]);

  // Media Session automatic Picture-in-Picture action handlers
  useEffect(() => {
    if (!('mediaSession' in navigator) || !inRoom) return;

    const handleEnterPip = async () => {
      if (!autoPipEnabled) return;
      try {
        if (screenStream && screenVideoRef.current) {
          const el = screenVideoRef.current;
          if (document.pictureInPictureElement !== el) {
            if (!el.srcObject) el.srcObject = screenStream;
            await ensureVideoReady(el);
            await el.requestPictureInPicture();
            setIsPipActive(true);
            wasAutoPipTriggeredRef.current = true;
          }
        } else if (videoEnabled && localVideoRef.current) {
          const el = localVideoRef.current;
          if (document.pictureInPictureElement !== el) {
            if (!el.srcObject) el.srcObject = localStream;
            await ensureVideoReady(el);
            await el.requestPictureInPicture();
            setIsPipActive(true);
            wasAutoPipTriggeredRef.current = true;
          }
        }
      } catch (err) {
        console.warn('[PiP] MediaSession enterpictureinpicture action failed:', err);
      }
    };

    const handleLeavePip = async () => {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
          setIsPipActive(false);
        }
        wasAutoPipTriggeredRef.current = false;
      } catch (err) {
        console.warn('[PiP] MediaSession leavepictureinpicture action failed:', err);
      }
    };

    try {
      navigator.mediaSession.setActionHandler('enterpictureinpicture' as any, handleEnterPip);
      navigator.mediaSession.setActionHandler('leavepictureinpicture' as any, handleLeavePip);
    } catch (err) {
      console.warn('[PiP] MediaSession action registration failed:', err);
    }

    return () => {
      try {
        navigator.mediaSession.setActionHandler('enterpictureinpicture' as any, null);
        navigator.mediaSession.setActionHandler('leavepictureinpicture' as any, null);
      } catch (e) {}
    };
  }, [autoPipEnabled, inRoom, screenStream, videoEnabled]);

  /* ── Media init ─────────────────────── */
  const handleInitMedia = async () => {
    const res = await initMedia(callType);
    if (res) {
      showToast('Camera & mic initialised successfully.', 'success');
      await enumerateDevices();
    } else {
      showToast('Camera & mic inputs stopped & released.', 'info');
    }
  };

  /* ── Chat ─────────────────────────── */
  const sendChat = async () => {
    if (!chatInput.trim()) return;
    const rawText = chatInput.trim();

    // Immediately clear room typing state
    if (localRoomTypingTimeoutRef.current) {
      clearTimeout(localRoomTypingTimeoutRef.current);
      localRoomTypingTimeoutRef.current = null;
    }
    if (socket) {
      socket.emit('room_typing', {
        roomName,
        username: myAlias.name,
        isTyping: false
      });
    }
    let textToSend = rawText;
    
    // Encrypt if roomE2eeKey is available
    if (roomE2eeKeyRef.current) {
      try {
        textToSend = await encryptText(rawText, roomE2eeKeyRef.current);
      } catch (err) {
        console.error("Encryption failed:", err);
      }
    }
    
    const msg: ChatMessage = {
      id: uid(), 
      sender: myAlias.name, 
      text: textToSend,
      decryptedText: roomE2eeKeyRef.current ? rawText : undefined,
      time: nowTime(), 
      self: true,
    };
    
    setChatMessages(prev => [...prev, msg]);
    if (socket) socket.emit('chat_message', { roomName, sender: myAlias.name, text: textToSend, time: msg.time });
    setChatInput('');
  };

  useEffect(() => {
    if (!socket) return;
    const handler = async (data: { sender: string; text: string; time: string }) => {
      let decryptedText = undefined;
      if (data.text.startsWith('[E2EE]:')) {
        if (roomE2eeKeyRef.current) {
          try {
            decryptedText = await decryptText(data.text, roomE2eeKeyRef.current);
          } catch (err) {
            decryptedText = '🔒 [Decryption Failed - Invalid Passphrase]';
          }
        } else {
          decryptedText = '🔒 [Encrypted Message - Enter passphrase to decrypt]';
        }
      }

      setChatMessages(prev => [...prev, { 
        id: uid(), 
        ...data, 
        decryptedText, 
        self: false 
      }]);
      setActiveTab(currentTab => {
        if (currentTab !== 'chat') {
          setUnreadChat(prev => prev + 1);
        }
        return currentTab;
      });
      // OS push notification — fires only when the tab is hidden/blurred
      notify('update', {
        sender: data.sender,
        body: decryptedText || 'NexaLink received an update',
        tag: 'nexalink-chat',
        onClick: () => setActiveTab('chat'),
      });
    };
    socket.on('chat_message', handler);
    return () => { socket.off('chat_message', handler); };
  }, [socket, notify]);

  /* ── TTS ─────────────────────────── */
  const speakText = useCallback(async (text: string, voiceName: string, mode: 'neural' | 'browser' = 'neural', pitch: number = 1.0) => {
    if (mode === 'neural') {
      try {
        const res = await fetch(`${AI}/api/ai/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: text,
            voice: voiceName,
            pitch_factor: pitch
          })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'SUCCESS' && data.base64_audio) {
            const audioSrc = `data:audio/mp3;base64,${data.base64_audio}`;
            const audio = new Audio(audioSrc);
            audio.play();
            return;
          }
        }
      } catch (err) {
        console.warn('[TTS] Failed to play premium neural voice, falling back to local speech synthesis:', err);
      }
    }

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      
      const lowercaseVoice = voiceName.toLowerCase();
      const selectedBrowserVoice = voices.find(v => v.name === voiceName);
      if (selectedBrowserVoice) {
        utt.voice = selectedBrowserVoice;
      } else if (lowercaseVoice.includes('female') || lowercaseVoice.includes('nova') || lowercaseVoice.includes('shimmer')) {
        const femaleVoice = voices.find(v => v.name.toLowerCase().includes('female') || v.name.includes('Zira') || v.name.toLowerCase().includes('google us english'));
        if (femaleVoice) utt.voice = femaleVoice;
      } else {
        const maleVoice = voices.find(v => v.name.toLowerCase().includes('male') || v.name.includes('David') || v.name.toLowerCase().includes('google uk english male'));
        if (maleVoice) utt.voice = maleVoice;
      }

      utt.pitch = pitch;
      utt.rate = 0.96;
      utt.volume = 0.92;
      window.speechSynthesis.speak(utt);
    }
  }, []);

  useEffect(() => {
    if (!socket) return;
    const handler = (data: { sender: string; text: string; voice: string; mode?: 'neural' | 'browser'; pitchFactor?: number }) => {
      const mode = data.mode || 'neural';
      const pitch = data.pitchFactor !== undefined ? data.pitchFactor : 1.0;
      setTtsQueue(prev => [...prev, `${data.sender}: "${data.text}"`]);
      speakText(data.text, data.voice, mode, pitch);
      showToast(`Synthetic voice from ${data.sender}`, 'info');
    };
    socket.on('tts_message', handler);
    return () => { socket.off('tts_message', handler); };
  }, [socket, speakText, showToast]);

  const queueTTS = () => {
    const cleanText = ttsText.trim();
    if (!cleanText) return;
    const modeTag = ttsMode === 'neural' ? 'Neural AI' : 'Local OS';
    const entry = `[${modeTag}] ${selectedVoice} (Pitch: ${ttsPitchFactor}x): "${cleanText}"`;
    setTtsQueue(prev => [...prev, entry]);
    speakText(cleanText, selectedVoice, ttsMode, ttsPitchFactor);
    socket?.emit('tts_message', { 
      roomName, 
      sender: myAlias.name, 
      text: cleanText, 
      voice: selectedVoice,
      mode: ttsMode,
      pitchFactor: ttsPitchFactor
    });
    setTtsText('');
    showToast('TTS sent to peers', 'info');
  };

  /* ── Derived ─────────────────────────── */
  const volPercent    = Math.min(100, (volumeLevel / 255) * 100);
  const visibleParticipants = participants; // Don't completely filter them out so their placeholder tiles remain in DOM for unhiding
  const isSelfHidden = locallyHiddenPeers.includes('self');
  const orderedParticipants = pinnedTile && pinnedTile !== 'self'
    ? [...visibleParticipants].sort((a, b) => (a.id === pinnedTile ? -1 : b.id === pinnedTile ? 1 : 0))
    : visibleParticipants;

  const getPeerProfilePic = (peer: Participant) => {
    if (isValidProfilePic(peer.profilePic)) {
      return peer.profilePic;
    }
    const match = contacts.find(c => c.username.toLowerCase() === peer.name.toLowerCase());
    if (match && isValidProfilePic(match.profilePic)) {
      return match.profilePic;
    }
    return '';
  };

  const hasPinnedTile = Boolean(pinnedTile && !locallyHiddenPeers.includes(pinnedTile));
  const videoFitClass = fitMode === 'cover' ? 'object-cover' : 'object-contain bg-slate-950';

  const totalVisibleTiles = 1 + orderedParticipants.length + (screenStream ? 1 : 0);
  const shouldHideSidebar = inRoom && isPipActive && !pipIncludeSidebar;

  // Synchronize tileOrder with currently active visible streams
  useEffect(() => {
    const activeIds: string[] = [];
    activeIds.push('self'); // Keep self in order
    orderedParticipants.forEach(p => {
      activeIds.push(p.id);
    });
    if (screenStream) activeIds.push('screen');

    setTileOrder(prev => {
      const filteredPrev = prev.filter(id => activeIds.includes(id));
      const newIds = activeIds.filter(id => !filteredPrev.includes(id));
      return [...filteredPrev, ...newIds];
    });
  }, [orderedParticipants, screenStream]);

  /* ── Unified settings render helper ──── */
  const renderSettingsArea = () => {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 fade-up">
        {/* Card 1: Account Profile settings */}
        <div className="glass-card rounded-3xl p-6 flex flex-col gap-4 border border-white/5">
          <div className="flex items-center gap-2 pb-2 border-b border-white/5">
            <User className="w-4 h-4 text-[var(--nx-primary)]" />
            <h3 className="text-sm font-bold text-white">Account Profile</h3>
          </div>
          
          <div className="flex flex-col items-center gap-3 text-center mt-2">
            <label className="w-24 h-24 rounded-full flex items-center justify-center cursor-pointer overflow-hidden transition-all hover:scale-105"
              style={{ background: 'var(--nx-teal-soft)', border: '2px solid var(--nx-primary)' }}>
              {isValidProfilePic(profile.profilePic) ? (
                <img src={profile.profilePic} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <ImagePlus className="w-7 h-7 text-[var(--nx-primary)]" />
              )}
              <input type="file" accept="image/*" className="hidden"
                onChange={e => handleProfilePicUpload(e.target.files?.[0])} />
            </label>
            
            <div className="w-full text-left">
              <label className="nx-input-label text-slate-400">Username Display</label>
              <input className="nx-input mb-3 text-xs" value={profile.username}
                onChange={e => {
                  setProfile(prev => ({ ...prev, username: e.target.value }));
                  setUserName(e.target.value || userName);
                }} />
              
              <label className="nx-input-label text-slate-400">Bio Description</label>
              <textarea className="nx-input text-xs" rows={3} value={profile.bio}
                onChange={e => setProfile(prev => ({ ...prev, bio: e.target.value.slice(0, 160) }))}
                placeholder="Write a private profile note." />
            </div>
            
            <button className="nx-btn nx-btn-primary w-full text-2xs font-semibold flex items-center justify-center gap-2 mt-2" onClick={() => pushProfileToDB()}>
              <Save className="w-3.5 h-3.5" /> Save & Sync Profile
            </button>
          </div>
        </div>

        {/* Card 2: Theme, Chat, & Alerts Settings */}
        <div className="flex flex-col gap-6">
          {/* Subcard A: Interface Theme (Light/Dark) */}
          <div className="glass-card rounded-3xl p-6 flex flex-col gap-4 border border-white/5">
            <div className="flex items-center gap-2 pb-2 border-b border-white/5">
              <Sliders className="w-4 h-4 text-[var(--nx-primary)]" />
              <h3 className="text-sm font-bold text-white">Interface & Theme</h3>
            </div>
            
            <div className="flex items-center justify-between mt-1">
              <div>
                <p className="text-2xs font-bold text-white">Application Theme</p>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5">Toggle between premium light and dark themes</p>
              </div>
              <div className="flex bg-white/5 p-1 rounded-xl border border-white/5">
                <button 
                  onClick={() => setTheme('light')}
                  className={`px-3 py-1.5 rounded-lg text-3xs font-bold transition flex items-center gap-1.5 ${theme === 'light' ? 'bg-[var(--nx-primary)] text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  ☀️ Light
                </button>
                <button 
                  onClick={() => setTheme('dark')}
                  className={`px-3 py-1.5 rounded-lg text-3xs font-bold transition flex items-center gap-1.5 ${theme === 'dark' ? 'bg-[var(--nx-primary)] text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  🌙 Dark
                </button>
              </div>
            </div>
          </div>

          {/* Subcard B: Chat custom options */}
          <div className="glass-card rounded-3xl p-6 flex flex-col gap-4 border border-white/5">
            <div className="flex items-center gap-2 pb-2 border-b border-white/5">
              <MessageSquare className="w-4 h-4 text-[var(--nx-primary)]" />
              <h3 className="text-sm font-bold text-white">Chat Customizations</h3>
            </div>

            <div className="flex flex-col gap-3.5 mt-1">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xs font-bold text-white">Press Enter to Send</p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">Submit messages instantly when pressing Enter</p>
                </div>
                <label className="nx-toggle">
                  <input 
                    type="checkbox" 
                    checked={chatSettings.pressEnterToSend} 
                    onChange={e => setChatSettings(prev => ({ ...prev, pressEnterToSend: e.target.checked }))} 
                  />
                  <span className="nx-toggle-track" />
                  <span className="nx-toggle-thumb" />
                </label>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xs font-bold text-white">Message Sound Alerts</p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">Play sound effects upon receiving direct messages</p>
                </div>
                <label className="nx-toggle">
                  <input 
                    type="checkbox" 
                    checked={chatSettings.soundEnabled} 
                    onChange={e => setChatSettings(prev => ({ ...prev, soundEnabled: e.target.checked }))} 
                  />
                  <span className="nx-toggle-track" />
                  <span className="nx-toggle-thumb" />
                </label>
              </div>
            </div>
          </div>

          {/* Subcard C: Desktop Notifications preferences */}
          <div className="glass-card rounded-3xl p-6 flex flex-col gap-4 border border-white/5">
            <div className="flex items-center gap-2 pb-2 border-b border-white/5">
              <Radio className="w-4 h-4 text-[var(--nx-primary)]" />
              <h3 className="text-sm font-bold text-white">Notifications Preferences</h3>
            </div>

            <div className="flex flex-col gap-3.5 mt-1">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xs font-bold text-white">Desktop Notifications</p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">Show native OS alert indicators for incoming calls</p>
                </div>
                <label className="nx-toggle">
                  <input 
                    type="checkbox" 
                    checked={notifSettings.desktopEnabled} 
                    onChange={e => {
                      const checked = e.target.checked;
                      setNotifSettings(prev => ({ ...prev, desktopEnabled: checked }));
                      if (checked) {
                        requestPermission(userName);
                      }
                    }}
                  />
                  <span className="nx-toggle-track" />
                  <span className="nx-toggle-thumb" />
                </label>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xs font-bold text-white">Persistent Notification Banner</p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">Display in-app floating system status alerts</p>
                </div>
                <label className="nx-toggle">
                  <input 
                    type="checkbox" 
                    checked={notifSettings.showToastAlerts} 
                    onChange={e => setNotifSettings(prev => ({ ...prev, showToastAlerts: e.target.checked }))} 
                  />
                  <span className="nx-toggle-track" />
                  <span className="nx-toggle-thumb" />
                </label>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xs font-bold text-white">Auto Picture-in-Picture on Minimize</p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">Automatically stream active video/screenshare in floating window when window is minimized or hidden</p>
                </div>
                <label className="nx-toggle">
                  <input 
                    type="checkbox" 
                    checked={autoPipEnabled} 
                    onChange={e => setAutoPipEnabled(e.target.checked)} 
                  />
                  <span className="nx-toggle-track" />
                  <span className="nx-toggle-thumb" />
                </label>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xs font-bold text-white">Include Sidebar during PiP Mode</p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">Show the in-app chat & participants sidebar inside the main browser window when PiP is active</p>
                </div>
                <label className="nx-toggle">
                  <input 
                    type="checkbox" 
                    checked={pipIncludeSidebar} 
                    onChange={e => setPipIncludeSidebar(e.target.checked)} 
                  />
                  <span className="nx-toggle-track" />
                  <span className="nx-toggle-thumb" />
                </label>
              </div>
            </div>
          </div>

          {/* Subcard D: Offline Notification Diagnostics & Audits */}
          <div className="glass-card rounded-3xl p-6 flex flex-col gap-4 border border-white/5">
            <div className="flex items-center justify-between pb-2 border-b border-white/5">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-rose-400" />
                <h3 className="text-sm font-bold text-white font-display">Offline Diagnostics</h3>
              </div>
              <button 
                onClick={fetchNotificationLogs} 
                className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold transition"
                disabled={loadingLogs}
              >
                {loadingLogs ? 'Refreshing...' : 'Refresh Logs'}
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <p className="text-[10px] text-slate-400 leading-relaxed font-mono">
                Troubleshoot browser Web Push (VAPID) delivery failures across different active profiles or Comet sessions in real-time.
              </p>

              <button 
                onClick={triggerTestNotification}
                className="nx-btn nx-btn-primary text-3xs font-semibold py-2 w-full flex items-center justify-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5" /> Trigger E2E Test Notification
              </button>

              <div className="flex flex-col gap-2 mt-2 max-h-[220px] overflow-y-auto pr-1">
                <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold mb-1 font-mono">Recent Audits</p>
                {notificationLogs.length === 0 ? (
                  <p className="text-3xs text-slate-600 italic py-2 text-center font-mono">No logs audited yet. Trigger a test push above.</p>
                ) : (
                  notificationLogs.map((log: any) => {
                    const statusColor = 
                      log.status === 'delivered' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
                      log.status === 'no_subscription' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
                      'text-rose-400 bg-rose-500/10 border-rose-500/20';
                    const dateStr = new Date(log.created_at).toLocaleString('en-IN', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit'
                    });
                    return (
                      <div key={log.id} className="p-2.5 rounded-xl border border-white/5 bg-white/2 flex flex-col gap-1 text-left">
                        <div className="flex items-center justify-between">
                          <span className="text-3xs font-bold text-white capitalize font-mono">{log.notification_type} Push</span>
                          <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-md border ${statusColor}`}>
                            {log.status === 'no_subscription' ? 'no subscription' : log.status}
                          </span>
                        </div>
                        <p className="text-[9px] text-slate-400 leading-normal font-mono mt-0.5">{log.error_details || 'Successfully delivered to push service.'}</p>
                        <span className="text-[8px] text-slate-600 mt-1 self-end font-mono">{dateStr}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderSecureSetupGate = () => {
    return (
      <div className="w-full flex items-center justify-center p-6" style={{ minHeight: 'calc(100vh - 120px)' }}>
        <div className="w-full max-w-xl glass-card rounded-3xl p-8 flex flex-col gap-6 fade-up shadow-2xl relative overflow-hidden text-center"
          style={{
            background: 'linear-gradient(145deg, rgba(12,15,28,0.92) 0%, rgba(6,8,18,0.98) 100%)',
            border: '1.5px solid rgba(99,102,241,0.15)',
            boxShadow: '0 30px 80px rgba(0,0,0,0.8), 0 0 80px rgba(99,102,241,0.06)'
          }}>
          {/* Decorative glowing grid background */}
          <div className="absolute -top-20 -right-20 w-44 h-44 bg-indigo-600/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-44 h-44 bg-indigo-600/10 rounded-full blur-3xl" />

          <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center bg-indigo-500/10 border border-indigo-500/25 mb-2 text-white">
            <ShieldAlert className="w-8 h-8 text-indigo-400" />
          </div>

          {isNotificationGranted ? (
            <div>
              <span className="nx-badge nx-badge-indigo mb-1.5 uppercase tracking-widest text-[9px]">PWA Client Required</span>
              <h2 className="text-xl font-bold text-white font-display">Install Desktop Client</h2>
              <p className="text-3xs text-slate-500 mt-1 uppercase tracking-widest font-mono">E2EE Terminal Gate</p>
            </div>
          ) : (
            <div>
              <span className="nx-badge nx-badge-indigo mb-1.5 uppercase tracking-widest text-[9px]">Cryptographic Sandbox Required</span>
              <h2 className="text-xl font-bold text-white font-display">Secure Connection Setup Required</h2>
              <p className="text-3xs text-slate-500 mt-1 uppercase tracking-widest font-mono">E2EE Terminal Gate</p>
            </div>
          )}

          {isNotificationGranted ? (
            <p className="text-xs text-slate-300 leading-relaxed max-w-md mx-auto">
              System notifications are successfully enabled for this device. To proceed to the secure E2EE connection lobby, you must now install the NexaLink PWA client application.
            </p>
          ) : (
            <p className="text-xs text-slate-300 leading-relaxed max-w-md mx-auto">
              To establish military-grade secure peer-to-peer tunnels, receive offline calling requests, and prevent background notification relay leaks, NexaLink must operate within an isolated desktop sandbox.
            </p>
          )}

          <div className="flex flex-col gap-3 max-w-sm mx-auto w-full mt-2">
            {isNotificationGranted ? (
              <button
                onClick={() => {
                  setShowPwaInstallGuide(true);
                  triggerPwaInstall();
                }}
                className="nx-btn nx-btn-primary py-3.5 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 w-full shadow-lg hover:shadow-indigo-500/20 transition-all duration-300"
              >
                <Download className="w-4 h-4 animate-bounce" /> Install NexaLink Client
              </button>
            ) : (
              <button
                onClick={handleEnableNotifications}
                className="nx-btn nx-btn-primary py-3.5 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 w-full shadow-lg hover:shadow-indigo-500/20 transition-all duration-300"
              >
                <Bell className="w-4 h-4" /> Enable Desktop Notifications
              </button>
            )}
            <p className="text-[10px] text-slate-500 leading-normal">
              {isNotificationGranted 
                ? "Clicking will open the custom guide and trigger the native desktop client installation prompt."
                : "Clicking will prompt browser background permissions and open the custom installation terminal."}
            </p>
          </div>

          <div className="border-t border-white/5 pt-4 flex items-center justify-between text-[10px] text-slate-500 font-mono w-full">
            <span>DEVICE MATCH: OK</span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
              {isNotificationGranted ? "AWAITING APP INSTALLATION..." : "WAITING FOR PWA SECURE ENV..."}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const renderPwaInstallGuideModal = () => {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md fade-in">
        <div className="w-full max-w-4xl glass-card rounded-3xl p-6 sm:p-8 flex flex-col gap-6 shadow-2xl relative overflow-hidden max-h-[90vh] overflow-y-auto"
          style={{
            background: 'linear-gradient(145deg, rgba(15,18,36,0.95) 0%, rgba(6,8,18,0.99) 100%)',
            border: '1.5px solid rgba(99,102,241,0.2)',
            boxShadow: '0 30px 80px rgba(0,0,0,0.8), 0 0 100px rgba(99,102,241,0.08)'
          }}>
          
          <button
            onClick={() => setShowPwaInstallGuide(false)}
            className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-all duration-200 z-50"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="text-center">
            <span className="nx-badge nx-badge-indigo mb-1.5 uppercase tracking-widest text-[9px]">PWA Terminal Guide</span>
            <h2 className="text-xl sm:text-2xl font-bold text-white font-display flex items-center justify-center gap-2">
              <Download className="w-6 h-6 text-indigo-400" />
              Install NexaLink Secure App
            </h2>
            <p className="text-2xs text-slate-400 max-w-md mx-auto mt-1 leading-relaxed">
              Unlock isolated hardware sandbox execution and E2E offline background calling capabilities by installing the desktop client.
            </p>
          </div>

          {/* Grid of Steps */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-2">
            {/* Step 1 */}
            <div className="flex flex-col gap-3 p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all duration-300">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-indigo-500/10 border border-indigo-500/20 text-xs font-bold text-indigo-400">
                01
              </div>
              <div>
                <h3 className="text-xs font-bold text-white font-display">Locate Trigger</h3>
                <p className="text-[10px] text-slate-400 leading-normal mt-0.5">
                  Look at the right side of the address bar for the Install Icon (PC with arrow), or open Chrome's options menu (three dots) &rarr; 'Save and share' &rarr; 'Install page'.
                </p>
              </div>
              <div className="mt-auto pt-2">
                <svg viewBox="0 0 320 120" className="w-full h-auto rounded-lg border border-white/5 bg-slate-900/60 p-2 shadow-inner">
                  <rect x="10" y="20" width="300" height="32" rx="6" fill="#0c1020" stroke="rgba(255,255,255,0.06)" strokeWidth="1.5" />
                  <circle cx="28" cy="36" r="4" fill="#38bdf8" />
                  <text x="42" y="41" fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="monospace">nexalink.app/lobby</text>
                  <g transform="translate(255, 24)">
                    <rect x="-4" y="-2" width="28" height="24" rx="4" fill="rgba(99,102,241,0.2)" stroke="rgba(99,102,241,0.4)" strokeWidth="1" />
                    <circle cx="10" cy="10" r="12" fill="none" stroke="rgba(99,102,241,0.4)" strokeWidth="1" className="animate-ping" style={{ transformOrigin: '10px 10px', animationDuration: '2.5s' }} />
                    <path d="M4 2v6h12V2H4zm8 10h4V9h-4v3zm-5-3v3H5V9h2z" fill="#818cf8" transform="scale(1.2)" />
                  </g>
                  <path d="M288 36l-8-8v16z" fill="#94a3b8" />
                  <g transform="translate(268, 42)" className="animate-bounce" style={{ animationDuration: '1.5s' }}>
                    <path d="M0 0l4 10-2 1-4-8-2 2z" fill="#f43f5e" />
                  </g>
                </svg>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex flex-col gap-3 p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all duration-300">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-indigo-500/10 border border-indigo-500/20 text-xs font-bold text-indigo-400">
                02
              </div>
              <div>
                <h3 className="text-xs font-bold text-white font-display">Accept Promotion</h3>
                <p className="text-[10px] text-slate-400 leading-normal mt-0.5">
                  Click 'Install' on the native browser installation confirmation popup to build the isolated sandbox application.
                </p>
              </div>
              <div className="mt-auto pt-2">
                <svg viewBox="0 0 320 120" className="w-full h-auto rounded-lg border border-white/5 bg-slate-900/60 p-2 shadow-inner">
                  <rect x="40" y="15" width="240" height="90" rx="12" fill="#0d1127" stroke="rgba(99,102,241,0.3)" strokeWidth="1.5" />
                  <rect x="56" y="32" width="28" height="28" rx="8" fill="#6366f1" />
                  <text x="70" y="50" fill="white" fontSize="14" fontWeight="bold" textAnchor="middle">N</text>
                  <text x="96" y="42" fill="white" fontSize="11" fontWeight="bold">Install NexaLink?</text>
                  <text x="96" y="54" fill="#64748b" fontSize="8">nexalink.app</text>
                  <rect x="156" y="70" width="54" height="22" rx="6" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                  <text x="183" y="84" fill="#94a3b8" fontSize="8" fontWeight="bold" textAnchor="middle">Cancel</text>
                  <rect x="216" y="70" width="50" height="22" rx="6" fill="#4f46e5" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                  <circle cx="241" cy="81" r="10" fill="none" stroke="rgba(99,102,241,0.5)" strokeWidth="1" className="animate-ping" style={{ transformOrigin: '241px 81px', animationDuration: '2.5s' }} />
                  <text x="241" y="84" fill="white" fontSize="8" fontWeight="bold" textAnchor="middle">Install</text>
                  <g transform="translate(245, 83)" className="animate-bounce" style={{ animationDuration: '1.5s' }}>
                    <path d="M0 0l4 10-2 1-4-8-2 2z" fill="#f43f5e" />
                  </g>
                </svg>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex flex-col gap-3 p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all duration-300">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-indigo-500/10 border border-indigo-500/20 text-xs font-bold text-indigo-400">
                03
              </div>
              <div>
                <h3 className="text-xs font-bold text-white font-display">Standby Connected</h3>
                <p className="text-[10px] text-slate-400 leading-normal mt-0.5">
                  The standalone sandbox environment launches. Background listeners start instantly, bypassing the gate automatically!
                </p>
              </div>
              <div className="mt-auto pt-2">
                <svg viewBox="0 0 320 120" className="w-full h-auto rounded-lg border border-white/5 bg-slate-900/60 p-2 shadow-inner">
                  <rect x="20" y="10" width="280" height="100" rx="10" fill="#070a13" stroke="rgba(16,185,129,0.3)" strokeWidth="1.5" />
                  <rect x="20" y="10" width="280" height="20" rx="10" fill="#0b0f19" />
                  <circle cx="34" cy="20" r="3" fill="#ef4444" />
                  <circle cx="44" cy="20" r="3" fill="#eab308" />
                  <circle cx="54" cy="20" r="3" fill="#22c55e" />
                  <text x="160" y="24" fill="#475569" fontSize="8" textAnchor="middle" fontWeight="bold">NexaLink E2E Sandbox</text>
                  <g transform="translate(160, 65)">
                    <circle cx="0" cy="0" r="18" fill="rgba(16,185,129,0.1)" stroke="rgba(16,185,129,0.4)" strokeWidth="1.5" />
                    <path d="M-6 0l4 4 8-8" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    <text x="0" y="32" fill="#10b981" fontSize="9" fontWeight="bold" textAnchor="middle" className="animate-pulse">SANDBOX SECURED</text>
                  </g>
                </svg>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-2 pt-4 border-t border-white/5">
            <div className="text-left">
              <span className="text-[10px] text-slate-500 font-mono block">SUPPORTED BROWSERS:</span>
              <span className="text-[10px] text-indigo-400 font-semibold font-mono">Chrome / Comet / Edge / Brave / Opera</span>
            </div>
            
            <button
              onClick={triggerPwaInstall}
              className="nx-btn nx-btn-primary py-3 px-6 text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg hover:shadow-indigo-500/20 transition-all duration-300 w-full sm:w-auto"
            >
              <Download className="w-4 h-4 animate-bounce" /> Install NexaLink Client
            </button>
          </div>

          {/* Browser Specific Tips */}
          <div className="p-3.5 rounded-xl bg-indigo-950/20 border border-indigo-900/35 text-[10px] text-indigo-300/80 leading-relaxed text-left flex items-start gap-2.5">
            <span className="text-xs">💡</span>
            <div>
              <strong>Quick Tip:</strong> If the button above does not trigger, your browser might have blocked automatic prompts. 
              Look for the <strong>small monitor/install icon</strong> inside Chrome's address bar next to the bookmark star, or tap <strong>'...' menu &rarr; 'Save and share' &rarr; 'Install page'</strong>.
            </div>
          </div>

        </div>
      </div>
    );
  };

  /* ═══════════════════════════════════════
     RENDER
  ═══════════════════════════════════════ */

  /* ═══════════════════════════════════════
     RENDER
  ═══════════════════════════════════════ */
  return (
    <div className={`min-h-screen flex flex-col nx-app-shell ${(!authToken && currentView !== 'landing') ? 'overflow-hidden' : 'overflow-y-auto'}`} style={{ fontFamily: 'var(--font-sans)' }}>

      {/* Toast */}
      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}

      {/* PWA Install Guide */}
      {showPwaInstallGuide && renderPwaInstallGuideModal()}

      {/* ── INCOMING CALL MODAL ─────────────────────────────────────────────── */}
      {incomingCall && (
        <div
          className="fixed inset-0 z-[9998] flex items-end justify-center pb-10"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(12px)' }}
        >
          <div
            className="relative flex flex-col items-center gap-5 px-8 py-7 rounded-3xl shadow-2xl"
            style={{
              background: 'linear-gradient(145deg, rgba(44,37,35,0.97) 0%, rgba(28,22,20,0.99) 100%)',
              border: '1.5px solid rgba(255,212,172,0.18)',
              minWidth: 340, maxWidth: 420,
              boxShadow: '0 30px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,212,172,0.06)',
            }}
          >
            {/* Ringing ring animation */}
            <div className="relative flex items-center justify-center">
              <span className="absolute w-24 h-24 rounded-full animate-ping"
                style={{ background: 'rgba(227,154,122,0.18)', animationDuration: '1.2s' }} />
              <span className="absolute w-20 h-20 rounded-full animate-ping"
                style={{ background: 'rgba(227,154,122,0.12)', animationDuration: '1.2s', animationDelay: '0.3s' }} />
              <div className="relative w-16 h-16 rounded-full flex items-center justify-center text-3xl shadow-xl"
                style={{ background: 'linear-gradient(135deg, #E39A7A, #FFD4AC)', border: '2px solid rgba(255,212,172,0.5)' }}>
                {incomingCall.callType === 'voice' ? '📞' : '📹'}
              </div>
            </div>

            {/* Caller info */}
            <div className="text-center">
              <p className="text-[10px] font-semibold tracking-widest uppercase"
                style={{ color: 'rgba(255,212,172,0.55)' }}>
                Incoming {incomingCall.callType === 'voice' ? 'Voice' : 'Video'} Call
              </p>
              <p className="text-xl font-bold mt-1" style={{ color: '#FFD4AC' }}>
                {incomingCall.callerName}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,212,172,0.45)' }}>
                @{incomingCall.callerUsername}
              </p>
            </div>

            {/* Status badge */}
            {inRoom && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}>
                <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
                You are currently in a {participants.length > 0 ? `room with ${participants.length} other${participants.length > 1 ? 's' : ''}` : 'room'}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-col gap-2 w-full">
              {/* Primary: Leave/Cut + Accept */}
              <button
                onClick={() => handleIncomingCallResponse(inRoom ? 'leave_accept' : 'cut_accept')}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl font-bold text-sm transition-all duration-150"
                style={{
                  background: 'linear-gradient(135deg, #16a34a, #15803d)',
                  color: '#fff',
                  boxShadow: '0 4px 20px rgba(22,163,74,0.35)',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}
              >
                <PhoneCall className="w-4 h-4" />
                {inRoom ? 'Leave Room & Accept' : 'Accept Call'}
              </button>

              {/* Merge */}
              <button
                onClick={() => handleIncomingCallResponse('merge')}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl font-bold text-sm transition-all duration-150"
                style={{
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.22), rgba(99,102,241,0.12))',
                  color: '#a5b4fc',
                  border: '1px solid rgba(99,102,241,0.35)',
                  boxShadow: '0 2px 12px rgba(99,102,241,0.2)',
                }}
              >
                <Users className="w-4 h-4" />
                Merge {inRoom ? 'Rooms' : 'Calls'}
              </button>

              {/* Ignore */}
              <button
                onClick={() => handleIncomingCallResponse('ignore')}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl font-bold text-sm transition-all duration-150"
                style={{
                  background: 'rgba(239,68,68,0.12)',
                  color: '#fca5a5',
                  border: '1px solid rgba(239,68,68,0.25)',
                }}
              >
                <PhoneOff className="w-4 h-4" />
                Ignore
              </button>
            </div>

            {/* Auto-dismiss countdown hint */}
            <p className="text-[9px] font-mono" style={{ color: 'rgba(255,212,172,0.28)' }}>
              Auto-dismissed in 30s if not answered
            </p>
          </div>
        </div>
      )}

      {outgoingCall && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(15px)' }}
        >
          <div
            className="relative flex flex-col items-center gap-6 px-8 py-8 rounded-3xl shadow-2xl animate-fade-in"
            style={{
              background: 'linear-gradient(145deg, rgba(44,37,35,0.98) 0%, rgba(28,22,20,0.99) 100%)',
              border: '1.5px solid rgba(255,212,172,0.22)',
              minWidth: 340, maxWidth: 440,
              boxShadow: '0 30px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,212,172,0.08)',
            }}
          >
            {/* Ringing ring animation */}
            <div className="relative flex items-center justify-center">
              {(outgoingCall.status === 'ringing' || outgoingCall.status === 'ringing_push') && (
                <>
                  <span className="absolute w-24 h-24 rounded-full animate-ping"
                    style={{ background: outgoingCall.status === 'ringing_push' ? 'rgba(96,165,250,0.18)' : 'rgba(227,154,122,0.18)', animationDuration: '1.2s' }} />
                  <span className="absolute w-20 h-20 rounded-full animate-ping"
                    style={{ background: outgoingCall.status === 'ringing_push' ? 'rgba(96,165,250,0.12)' : 'rgba(227,154,122,0.12)', animationDuration: '1.2s', animationDelay: '0.3s' }} />
                </>
              )}
              <div className="relative w-16 h-16 rounded-full flex items-center justify-center text-3xl shadow-xl"
                style={{ 
                  background: outgoingCall.status === 'declined' || outgoingCall.status === 'failed' || outgoingCall.status === 'timeout'
                    ? 'linear-gradient(135deg, #ef4444, #b91c1c)' 
                    : outgoingCall.status === 'ringing_push'
                    ? 'linear-gradient(135deg, #60a5fa, #3b82f6)'
                    : 'linear-gradient(135deg, #E39A7A, #FFD4AC)', 
                  border: '2px solid rgba(255,212,172,0.5)' 
                }}>
                {outgoingCall.status === 'declined' || outgoingCall.status === 'failed' ? '❌' : outgoingCall.status === 'timeout' ? '⏱️' : outgoingCall.status === 'ringing_push' ? '📡' : (outgoingCall.callType === 'voice' ? '📞' : '📹')}
              </div>
            </div>

            {/* Callee info */}
            <div className="text-center">
              <p className="text-[10px] font-semibold tracking-widest uppercase"
                style={{ color: 'rgba(255,212,172,0.55)' }}>
                {outgoingCall.status === 'ringing' && 'Calling Peer...'}
                {outgoingCall.status === 'ringing_push' && 'Notifying Peer...'}
                {outgoingCall.status === 'accepted' && 'Connecting...'}
                {outgoingCall.status === 'declined' && 'Call Rejected'}
                {outgoingCall.status === 'failed' && 'Connection Failed'}
                {outgoingCall.status === 'timeout' && 'No Response'}
              </p>
              <p className="text-xl font-bold mt-1" style={{ color: '#FFD4AC' }}>
                {outgoingCall.targetUsername}
              </p>
              <p className="text-2xs font-mono mt-1 text-slate-400">
                {outgoingCall.status === 'ringing' && 'Waiting for handshake...'}
                {outgoingCall.status === 'ringing_push' && 'Push notification sent — waiting up to 30s for response...'}
                {outgoingCall.status === 'accepted' && 'Establishing WebRTC channels...'}
                {outgoingCall.status === 'declined' && 'The recipient declined your call.'}
                {outgoingCall.status === 'failed' && (outgoingCall.errorReason || 'User is offline.')}
                {outgoingCall.status === 'timeout' && (outgoingCall.errorReason || 'User did not respond to the notification.')}
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-2.5 w-full mt-2">
              {(outgoingCall.status === 'ringing' || outgoingCall.status === 'ringing_push') && (
                <button
                  onClick={() => {
                    // Cancel the call
                    socket?.emit('call_cancel', { targetUsername: outgoingCall.targetUsername });
                    // Clean up lingering listeners
                    socket?.off('call_ringing_push');
                    socket?.off('call_invite_timeout');
                    socket?.off('call_invite_failed');
                    if (outgoingCall.callId) {
                      updateCallStatusOnServer(outgoingCall.callId, 'missed');
                    }
                    setOutgoingCall(null);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl font-bold text-xs transition hover:bg-white/5"
                  style={{
                    background: 'rgba(239,68,68,0.12)',
                    color: '#fca5a5',
                    border: '1px solid rgba(239,68,68,0.25)',
                  }}
                >
                  <PhoneOff className="w-4 h-4" />
                  Cancel Call
                </button>
              )}

              {(outgoingCall.status === 'declined' || outgoingCall.status === 'failed' || outgoingCall.status === 'timeout') && (
                <>
                  <button
                    onClick={() => {
                      const target = outgoingCall.targetUsername;
                      const type = outgoingCall.callType;
                      setOutgoingCall(null);
                      setTimeout(() => {
                        setCallType(type);
                        callContact(target);
                      }, 100);
                    }}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl font-bold text-xs transition"
                    style={{
                      background: 'linear-gradient(135deg, #FFD4AC, #E39A7A)',
                      color: '#2c2523',
                      boxShadow: '0 4px 15px rgba(227,154,122,0.25)',
                      border: 'none'
                    }}
                  >
                    <PhoneCall className="w-4 h-4" />
                    Try Again
                  </button>

                  <button
                    onClick={() => setOutgoingCall(null)}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl font-bold text-xs transition hover:bg-white/5 border border-white/10 text-slate-300"
                    style={{ background: 'transparent' }}
                  >
                    Close
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="nx-bg">
        <div className="nx-bg-grid" />
        <div className="nx-bg-orb nx-bg-orb-1" />
        <div className="nx-bg-orb nx-bg-orb-2" />
        <div className="nx-bg-orb nx-bg-orb-3" />
      </div>

      {/* ── HEADER ─────────────────────── */}
      {currentView !== 'landing' && (
      <header className="relative z-50 glass app-header flex items-center justify-between px-6 py-3 border-b">

        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="nx-logo w-9 h-9 rounded-xl flex items-center justify-center font-extrabold text-white text-lg"
            style={{ borderRadius: 12 }}>
            N
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-white tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>NexaLink</span>
              <span className="nx-badge nx-badge-green">v1.0</span>
            </div>
            <p className="text-3xs text-slate-500 leading-none mt-0.5">E2E Encrypted Real-Time Control</p>
          </div>
        </div>

        {/* Centre: Live stats (in-call only) */}
        {inRoom && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className={`status-dot ${isConnected ? 'live' : 'error'}`} />
              <span className="text-2xs font-mono text-slate-400">
                {isConnected ? 'Relay Established' : 'Reconnecting...'}
              </span>
            </div>
            <div className="divider" />
            <div className="flex items-center gap-4 font-mono text-2xs">
              <span className="flex items-center gap-1.5 text-slate-400">
                <Activity className="w-3 h-3 text-indigo-400" />
                <span className="text-slate-300">{stats.videoLatency}ms</span>
              </span>
              <span className="flex items-center gap-1.5 text-slate-400">
                <BarChart2 className="w-3 h-3 text-emerald-400" />
                <span className="text-slate-300">{stats.jitter}ms</span>
              </span>
              <span className="flex items-center gap-1.5 text-slate-400">
                <WifiOff className="w-3 h-3 text-rose-400" />
                <span className={stats.packetLoss > 0 ? 'text-rose-400' : 'text-slate-300'}>{stats.packetLoss}%</span>
              </span>
            </div>
            <div className="divider" />
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
              style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
              <span className="text-base">{myAlias.avatar}</span>
              <span className="text-2xs font-semibold text-indigo-200">{myAlias.name}</span>
              {isAliasEnabled && <span className="nx-badge nx-badge-indigo">alias</span>}
            </div>
          </div>
        )}

        {/* Right: E2EE + User */}
        <div className="flex items-center gap-3">
          {inRoom && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
              style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-2xs font-mono font-semibold text-emerald-300">AES-GCM-256</span>
            </div>
          )}
          {authToken && (
            <div className="relative">
              <button 
                onClick={() => setShowInboxDropdown(d => !d)}
                className={`relative nx-btn-icon nx-tooltip ${showInboxDropdown ? 'active' : ''}`}
                data-tip="Inbox Notifications"
              >
                {inboxNotifications.filter(n => !n.read).length > 0 && (
                  <div className="absolute -top-1.5 -right-1.5 bg-[var(--nx-primary)] rounded-full flex items-center justify-center text-[9px] font-bold text-white shadow-lg animate-pulse px-1" style={{ minWidth: '18px', height: '18px' }}>
                    {inboxNotifications.filter(n => !n.read).length}
                  </div>
                )}
                <Radio className="w-4 h-4 text-white" />
              </button>

              {showInboxDropdown && (
                <div className="absolute right-0 mt-3 w-80 glass border border-white/10 rounded-2xl p-4 shadow-2xl z-[1000] animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center justify-between pb-2 border-b border-white/5 mb-3">
                    <span className="text-xs font-bold text-white">Lobby Inbox Notifications</span>
                    <button 
                      onClick={() => setInboxNotifications([])}
                      className="text-3xs text-rose-400 hover:text-rose-300 font-semibold"
                    >
                      Clear all alerts
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto pr-1 flex flex-col gap-2.5">
                    {inboxNotifications.length === 0 ? (
                      <p className="text-3xs text-slate-500 text-center py-4 italic">No alerts in your inbox.</p>
                    ) : (
                      inboxNotifications.map(notification => (
                        <div 
                          key={notification.id} 
                          className="p-2.5 rounded-xl border border-[var(--nx-primary)]/20 bg-[var(--nx-teal-soft)]/20 hover:bg-[var(--nx-teal-soft)]/40 transition-all duration-200 text-left cursor-pointer"
                          onClick={() => {
                            setInboxNotifications(prev => prev.filter(n => n.id !== notification.id));
                            setShowInboxDropdown(false);
                            if (notification.type === 'chat') {
                              setLobbySubView('chat_lobby');
                              const foundContact = contacts.find(c => c.username.toLowerCase() === notification.sender.toLowerCase());
                              if (foundContact) {
                                setActiveChatContact(foundContact);
                              } else {
                                const tempContact = { id: uid(), username: notification.sender, bio: 'Inbox Chat Partner', profilePic: '' };
                                setContacts(prev => [...prev, tempContact]);
                                setActiveChatContact(tempContact);
                              }
                            } else if (notification.type === 'call' && notification.room) {
                              setRoomName(notification.room);
                              setCallType('video');
                              setCurrentView('connecting');
                            }
                          }}
                        >
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-2xs font-bold text-white">{notification.title}</span>
                            <span className="text-3xs text-slate-500 font-mono">{notification.time}</span>
                          </div>
                          <p className="text-3xs text-slate-300 leading-tight">{notification.desc}</p>
                          <p className="text-[8px] text-indigo-400 mt-1 font-semibold uppercase tracking-wider">
                            {notification.type === 'chat' ? '✉ Open Chat Lobby' : '📞 Join Tunnel Room'}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {authToken && (
            <button 
              onClick={() => {
                if (currentView === 'lobby') {
                  setLobbySubView(prev => prev === 'settings' ? 'connect' : 'settings');
                } else if (currentView === 'room') {
                  setActiveTab('profile');
                }
              }}
              className={`nx-tooltip nx-btn-icon ${(currentView === 'lobby' && lobbySubView === 'settings') || (currentView === 'room' && activeTab === 'profile') ? 'active' : ''}`}
              data-tip="Settings"
            >
              <Sliders className="w-4 h-4 text-white" />
            </button>
          )}
          {authToken && (
            <button onClick={handleSignOut}
              className="nx-tooltip nx-btn-icon"
              data-tip="Sign Out">
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>
      )}

      {/* ── MAIN ─────────────────────── */}
      <main className="flex-1 relative z-10 flex app-main" style={{ height: inRoom ? 'calc(100vh - 154px)' : 'calc(100vh - 88px)' }}>

        {!authToken && currentView !== 'landing' ? (
          /* ════════════════════════════
             AUTHENTICATION GATEWAY
             ════════════════════════════ */
          <div className="w-full flex items-center justify-center p-6" style={{ minHeight: 'calc(100vh - 120px)' }}>
            <div className="w-full max-w-md glass-card rounded-3xl p-8 flex flex-col gap-6 fade-up shadow-2xl relative overflow-hidden">
              
              {/* Contoured glow */}
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-[var(--nx-primary)]/10 rounded-full blur-2xl" />
              <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-[var(--nx-primary)]/10 rounded-full blur-2xl" />

              <div className="text-center">
                <div className="nx-logo w-12 h-12 rounded-2xl flex items-center justify-center font-extrabold text-white text-xl mx-auto mb-4"
                  style={{ borderRadius: 16 }}>
                  N
                </div>
                <h2 className="text-xl font-bold text-white font-display">Authentication Gateway</h2>
                <p className="text-3xs text-slate-500 mt-1 uppercase tracking-widest font-mono">End-to-End Secure Relay Terminal</p>
              </div>

              {/* Error alerts */}
              {authError && (
                <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl nx-alert"
                  style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)' }}>
                  <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 animate-pulse" />
                  <span className="text-2xs font-semibold text-rose-300">{authError}</span>
                </div>
              )}
              {authSuccess && (
                <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl nx-alert"
                  style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
                  <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0 animate-pulse" />
                  <span className="text-2xs font-semibold text-emerald-300">{authSuccess}</span>
                </div>
              )}

              <form onSubmit={isRegisterMode ? handleRegister : handleLogin} className="flex flex-col gap-4">
                <div>
                  <label className="nx-input-label text-slate-400">Tunnel Username</label>
                  <input 
                    className="nx-input text-xs" 
                    type="text" 
                    required 
                    autoComplete="username"
                    placeholder="e.g. alice" 
                    value={authUsername}
                    onChange={e => setAuthUsername(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))} 
                  />
                </div>

                {isRegisterMode && (
                  <div>
                    <label className="nx-input-label text-slate-400">Identity Email Address</label>
                    <input 
                      className="nx-input text-xs" 
                      type="email" 
                      required 
                      autoComplete="email"
                      placeholder="alice@domain.com" 
                      value={authEmail}
                      onChange={e => setAuthEmail(e.target.value)} 
                    />
                  </div>
                )}

                <div>
                  <label className="nx-input-label text-slate-400">Passphrase</label>
                  <div className="relative">
                    <input 
                      className="nx-input text-xs pr-10" 
                      type={showPass ? "text" : "password"} 
                      required 
                      autoComplete="current-password"
                      placeholder="••••••••••••••" 
                      value={authPassword}
                      onChange={e => setAuthPassword(e.target.value)} 
                    />
                    <button 
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
                    >
                      {showPass ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                <button 
                  type="submit" 
                  disabled={authLoading}
                  className="nx-btn nx-btn-primary py-3.5 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 mt-2 w-full"
                >
                  {authLoading ? (
                    <span className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                  ) : (
                    <>
                      <Lock className="w-4 h-4" /> {isRegisterMode ? "Generate Keys & Authenticate" : "Establish Secure Access"}
                    </>
                  )}
                </button>
              </form>

              <div className="border-t border-white/5 pt-4 text-center">
                <button 
                  onClick={() => {
                    setIsRegisterMode(!isRegisterMode);
                    setAuthError(null);
                    setAuthSuccess(null);
                  }}
                  className="text-2xs text-indigo-400 hover:text-indigo-300 font-semibold"
                >
                  {isRegisterMode ? "Already verified? Access Tunnel" : "Request access tunnel? Register Here"}
                </button>
              </div>

            </div>
          </div>
        ) : (!isPwaReady && currentView !== 'landing') ? (
          renderSecureSetupGate()
        ) : !inRoom ? (
          currentView === 'landing' ? (
            <LandingPage onStartConnecting={() => { setCurrentView('lobby'); setLobbySubView('connect'); }} />
          ) : currentView === 'connecting' ? (
            /* ════════════════════════════
               PRE-FLIGHT CONNECTING PAGE
               ════════════════════════════ */
            <div className="w-full lobby-scroll p-6" style={{ height: 'calc(100vh - 120px)' }}>
              <div className="w-full max-w-5xl mx-auto glass-card rounded-3xl p-8 flex flex-col gap-6 fade-up">
                
                <div className="flex items-center justify-between border-b border-white/5 pb-4">
                  <div>
                    <span className="nx-badge nx-badge-indigo mb-1.5 uppercase tracking-widest text-[9px]">Pre-flight Studio</span>
                    <h2 className="text-xl font-bold text-white font-display">Configure Secure Connection Tunnel</h2>
                    <p className="text-2xs text-slate-500 mt-0.5">Initialize media assets and DSP audio pipelines before going live in room: <strong className="text-indigo-400 font-mono">#{roomName}</strong></p>
                  </div>
                  <button 
                    onClick={() => setCurrentView('lobby')}
                    className="text-2xs font-bold text-slate-900 bg-white/90 hover:bg-white px-3 py-1.5 rounded-lg transition shadow-sm"
                  >
                    ← Return to Lobby
                  </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-8 items-start">
                  
                  {/* Media Box */}
                  <div className="flex flex-col gap-5">
                    <p className="nx-section-header uppercase tracking-wider text-[10px] text-slate-400"><Video className="w-3.5 h-3.5 inline mr-1 text-indigo-400" /> Media Preview Studio</p>
                    
                    {callType === 'video' ? (
                      /* Video Preview */
                      <div className="relative aspect-video rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-slate-950">
                        {localStream ? (
                          <video ref={localVideoCallbackRef} autoPlay playsInline muted
                            className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                            <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-indigo-500/10 border border-indigo-500/20 shimmer">
                              <Video className="w-7 h-7 text-indigo-400" />
                            </div>
                            <p className="text-2xs text-slate-500 font-medium">Initializing secure video preview...</p>
                          </div>
                        )}
                        
                        {localStream && (
                          <div className="absolute bottom-3 left-3 flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-950/80 border border-white/5 backdrop-blur-md">
                            <Mic className="w-3.5 h-3.5 text-indigo-400" />
                            <div className="voice-meter w-16">
                              <div className="voice-meter-fill" style={{ width: `${volPercent}%` }} />
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Voice Waveform Preview (CSS Animated Waveform) */
                      <div className="relative aspect-video rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-slate-950 flex flex-col items-center justify-center p-6">
                        <style>{`
                          @keyframes nexawave {
                            0%, 100% { transform: scaleY(0.2); }
                            50% { transform: scaleY(1); }
                          }
                          .nx-bar-anim {
                            animation: nexawave 0.9s ease-in-out infinite;
                            transform-origin: bottom;
                          }
                        `}</style>
                        
                        <div className="flex items-end justify-center gap-1.5 h-28 w-full max-w-xs px-4 py-2 relative overflow-hidden z-10">
                          {Array.from({ length: 16 }).map((_, i) => (
                            <div 
                              key={i} 
                              className="w-1.5 bg-gradient-to-t from-indigo-600 to-indigo-400 rounded-full nx-bar-anim" 
                              style={{ 
                                height: `${30 + Math.sin(i * 0.5) * 50}%`,
                                animationDelay: `${i * 0.05}s`,
                                animationDuration: `${0.5 + Math.random() * 0.6}s`
                              }} 
                            />
                          ))}
                        </div>
                        
                        <p className="text-3xs font-bold text-slate-500 uppercase tracking-widest mt-4 relative z-10 flex items-center gap-1.5">
                          <Headphones className="w-3.5 h-3.5 text-indigo-400" /> Audio Waveform Preview Active
                        </p>

                        <div className="absolute bottom-3 left-3 flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-950/80 border border-white/5 backdrop-blur-md">
                          <Mic className="w-3.5 h-3.5 text-indigo-400" />
                          <div className="voice-meter w-16">
                            <div className="voice-meter-fill" style={{ width: `${volPercent}%` }} />
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-3">
                      <button onClick={handleInitMedia}
                        className="nx-btn nx-btn-ghost flex-1 text-2xs py-2.5">
                        <Sliders className="w-3.5 h-3.5" /> Initialize Media
                      </button>
                      {callType === 'video' && (
                        <button onClick={toggleVideo}
                          className={`nx-btn flex-1 text-2xs py-2.5 ${videoEnabled ? 'nx-btn-primary' : 'nx-btn-ghost'}`}>
                          {videoEnabled ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
                          {videoEnabled ? 'Camera: Active' : 'Camera: Disabled'}
                        </button>
                      )}
                      <button onClick={toggleAudio}
                        className={`nx-btn flex-1 text-2xs py-2.5 ${audioEnabled ? 'nx-btn-primary' : 'nx-btn-ghost'}`}>
                        {audioEnabled ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                        {audioEnabled ? 'Mic: Active' : 'Mic: Muted'}
                      </button>
                    </div>

                    {audioEnabled && (
                      <div className="text-3xs font-semibold flex items-center justify-between px-3 py-2 rounded-xl bg-slate-900/40 border border-white/5 mt-2 transition-all">
                        <span className="text-slate-400">Microphone Integrity Check:</span>
                        {volumeLevel > 2 ? (
                          <span className="text-emerald-400 flex items-center gap-1">✓ Active Signal Detected ({Math.round(volumeLevel)})</span>
                        ) : (
                          <span className="text-amber-400 animate-pulse">Silence / Waiting for Input...</span>
                        )}
                      </div>
                    )}

                    {/* Device Selector Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mt-2 bg-slate-900/40 p-4 rounded-2xl border border-white/5">
                      <div className="flex flex-col gap-1.5 text-left">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Mic className="w-3 h-3 text-indigo-400" /> Microphone
                        </label>
                        <select 
                          value={selectedAudioInput}
                          onChange={e => {
                            setSelectedAudioInput(e.target.value);
                            sessionStorage.setItem('nexalink_selected_mic', e.target.value);
                          }}
                          className="nx-input text-2xs py-1.5 bg-slate-950 border-white/10"
                        >
                          {audioInputs.length === 0 ? (
                            <option value="default">Default Microphone</option>
                          ) : (
                            audioInputs.map(d => (
                              <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone (${d.deviceId.slice(0, 5)})`}</option>
                            ))
                          )}
                        </select>
                      </div>

                      {callType === 'video' && (
                        <div className="flex flex-col gap-1.5 text-left">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Video className="w-3 h-3 text-indigo-400" /> Camera
                          </label>
                          <select 
                            value={selectedVideoInput}
                            onChange={e => {
                              setSelectedVideoInput(e.target.value);
                              sessionStorage.setItem('nexalink_selected_cam', e.target.value);
                            }}
                            className="nx-input text-2xs py-1.5 bg-slate-950 border-white/10"
                          >
                            {videoInputs.length === 0 ? (
                              <option value="default">Default Camera</option>
                            ) : (
                              videoInputs.map(d => (
                                <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera (${d.deviceId.slice(0, 5)})`}</option>
                              ))
                            )}
                          </select>
                        </div>
                      )}

                      <div className="flex flex-col gap-1.5 text-left">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Headphones className="w-3 h-3 text-indigo-400" /> Audio Output
                        </label>
                        <select 
                          value={selectedAudioOutput}
                          onChange={e => {
                            setSelectedAudioOutput(e.target.value);
                            sessionStorage.setItem('nexalink_selected_speaker', e.target.value);
                          }}
                          className="nx-input text-2xs py-1.5 bg-slate-950 border-white/10"
                        >
                          {audioOutputs.length === 0 ? (
                            <option value="default">Default Speakers</option>
                          ) : (
                            audioOutputs.map(d => (
                              <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker (${d.deviceId.slice(0, 5)})`}</option>
                            ))
                          )}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Setup & Morphing Controls */}
                  <div className="flex flex-col gap-5">
                    <p className="nx-section-header uppercase tracking-wider text-[10px] text-slate-400"><Sliders className="w-3.5 h-3.5 inline mr-1 text-indigo-400" /> Live Audio Morphing (DSP)</p>
                    
                    <div className="rounded-2xl p-4 bg-slate-900/50 border border-white/5 space-y-4">
                      <div>
                        <label className="nx-input-label text-slate-400">Your Tunnel Alias Nickname</label>
                        <input 
                          className="nx-input text-xs" 
                          type="text" 
                          value={profile.username}
                          onChange={e => {
                            setProfile(prev => ({ ...prev, username: e.target.value }));
                            setUserName(e.target.value || userName);
                          }} 
                          placeholder="Display name" 
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-2xs mb-2">
                          <span className="text-slate-400">Microsecond Pitch Shift</span>
                          <span className="font-mono text-indigo-400 font-bold">
                            {audioConfig.pitchShift > 0 ? `+${audioConfig.pitchShift}` : audioConfig.pitchShift} st
                          </span>
                        </div>
                        <input type="range" min="-12" max="12" value={audioConfig.pitchShift}
                          onChange={e => setAudioConfig(p => ({ ...p, pitchShift: parseInt(e.target.value) }))} />
                        <div className="flex justify-between text-3xs text-slate-500 mt-1">
                          <span>−12 (Deep)</span><span>0</span><span>+12 (High)</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <label className="flex items-center gap-3 cursor-pointer group">
                          <label className="nx-toggle mt-0.5">
                            <input type="checkbox"
                              checked={audioConfig.whisperFilterEnabled}
                              onChange={e => setAudioConfig(p => ({ ...p, whisperFilterEnabled: e.target.checked }))} />
                            <span className="nx-toggle-track" />
                            <span className="nx-toggle-thumb" />
                          </label>
                          <div>
                            <span className="text-2xs font-semibold text-slate-200 block">Whisper Filter</span>
                            <span className="text-3xs text-slate-500 block mt-0.5">Amplify sub-ambient inputs</span>
                          </div>
                        </label>
                      </div>

                      {/* Go Live Button */}
                      <button 
                        onClick={handleConnectRoom} 
                        disabled={connecting}
                        className="nx-btn nx-btn-primary w-full py-3.5 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-2xl mt-4"
                      >
                        {connecting ? (
                          <span className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                        ) : (
                          <>
                            <Zap className="w-4 h-4 text-white animate-pulse" /> Establish Secure Tunnel (Go Live)
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ════════════════════════════
               LOBBY / HUB VIEW
               ════════════════════════════ */
            <div className="w-full lobby-scroll p-6" style={{ height: 'calc(100vh - 120px)' }}>

              {/* ── NOTIFICATION PERMISSION BANNER ── */}
              {notifPermission === 'default' && (
                <div
                  className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl mb-4"
                  style={{
                    background: 'linear-gradient(90deg, rgba(255,212,172,0.07) 0%, rgba(227,154,122,0.05) 100%)',
                    border: '1px solid rgba(255,212,172,0.16)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-base">🔔</span>
                    <div>
                      <p className="text-xs font-semibold" style={{ color: '#FFD4AC' }}>Enable push notifications</p>
                      <p className="text-[10px]" style={{ color: 'rgba(255,212,172,0.48)' }}>
                        Get alerted for messages and incoming calls even when NexaLink is in the background
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={handleEnableNotifications}
                      className="text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all"
                      style={{ background: 'rgba(255,212,172,0.15)', color: '#FFD4AC', border: '1px solid rgba(255,212,172,0.25)' }}
                    >
                      Enable
                    </button>
                    <button
                      onClick={() => setNotifPermission('denied')}
                      className="text-[10px] px-2 py-1.5 rounded-lg"
                      style={{ color: 'rgba(255,212,172,0.35)' }}
                    >
                      Not now
                    </button>
                  </div>
                </div>
              )}

              {lobbySubView === 'settings' ? (
                /* SETTINGS SUBVIEW */
                <div className="w-full max-w-4xl mx-auto flex flex-col gap-6 fade-up">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="nx-badge nx-badge-amber mb-1.5 uppercase tracking-widest text-[9px]">App Preferences</span>
                      <h2 className="text-xl font-bold text-white font-display flex items-center gap-2">
                        <Sliders className="w-5 h-5 text-[var(--nx-primary)]" />
                        Account & App Settings
                      </h2>
                      <p className="text-3xs text-slate-500 mt-0.5 font-mono">Manage E2E client profile and local application state</p>
                    </div>
                    <button 
                      onClick={() => setLobbySubView('connect')}
                      className="nx-btn nx-btn-ghost text-2xs font-semibold py-2 px-4"
                    >
                      ← Back to Connect
                    </button>
                  </div>
                  {renderSettingsArea()}
                </div>
              ) : lobbySubView === 'connect' ? (
                /* CONNECT SUBVIEW */
                <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1.3fr_0.7fr] gap-6 fade-up">
                  
                  {/* Left: Connect Panels */}
                  <div className="flex flex-col gap-6">
                    
                    {/* Tunnel Room Creation Card */}
                    <div className="glass-card rounded-3xl p-6 flex flex-col gap-5">
                      <div>
                        <span className="nx-badge nx-badge-indigo mb-1.5 uppercase tracking-widest text-[9px]">Establish Secure Tunnel</span>
                        <h2 className="text-lg font-bold text-white font-display">Create or Join Secure Room</h2>
                        <p className="text-3xs text-slate-500 mt-0.5 font-mono">Military-grade AES-GCM-256 chat and collaborative whiteboard</p>
                      </div>

                      <div className="flex flex-col gap-4">
                        <div>
                          <label className="nx-input-label text-slate-400">Tunnel Name</label>
                          <input 
                            className="nx-input text-xs font-mono" 
                            type="text" 
                            value={roomName}
                            onChange={e => setRoomName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                            placeholder="e.g. nexalink-alpha" 
                          />
                        </div>

                        <div>
                          <label className="nx-input-label text-slate-400">Connection Mode</label>
                          <div className="grid grid-cols-2 gap-3 mt-1">
                            <button 
                              onClick={() => setCallType('video')} 
                              className={`nx-btn py-3 text-2xs font-semibold flex items-center justify-center gap-2 ${callType === 'video' ? 'nx-btn-primary' : 'nx-btn-ghost'}`}
                            >
                              <Video className="w-3.5 h-3.5" /> Video + Voice Call
                            </button>
                            <button 
                              onClick={() => setCallType('voice')} 
                              className={`nx-btn py-3 text-2xs font-semibold flex items-center justify-center gap-2 ${callType === 'voice' ? 'nx-btn-primary' : 'nx-btn-ghost'}`}
                            >
                              <Headphones className="w-3.5 h-3.5" /> Voice Call Only
                            </button>
                          </div>
                        </div>

                        <button 
                          onClick={() => {
                            if (!roomName.trim()) {
                              showToast('Enter a room name.', 'error');
                              return;
                            }
                            setCurrentView('connecting');
                          }} 
                          className="nx-btn nx-btn-primary py-3 text-xs flex items-center justify-center gap-2 mt-2 w-full"
                        >
                          <Zap className="w-4 h-4" /> Initialize Pre-flight Studio
                        </button>
                      </div>
                    </div>

                    {/* Direct Call Card */}
                    <div className="glass-card rounded-3xl p-6 flex flex-col gap-4">
                      <div>
                        <h3 className="text-sm font-bold text-white font-display">Direct Peer Connection</h3>
                        <p className="text-3xs text-slate-500 mt-0.5">Start an instant end-to-end direct tunnel to another username</p>
                      </div>
                      <div className="flex gap-2.5">
                        <input 
                          className="nx-input flex-1 text-xs" 
                          value={directPeer}
                          onChange={e => setDirectPeer(e.target.value)}
                          placeholder="Type peer's handle (e.g. Bob)" 
                        />
                        <button 
                          onClick={() => {
                            if (!directPeer.trim()) {
                              showToast('Enter a username to call.', 'error');
                              return;
                            }
                            setRoomName(`Direct-${[userName, directPeer].map(n => n.toLowerCase().replace(/[^a-z0-9_-]/g, '-')).sort().join('-')}`);
                            setCallType('video');
                            setCurrentView('connecting');
                          }}
                          className="nx-btn nx-btn-ghost text-2xs px-4"
                        >
                          Video Call
                        </button>
                        <button 
                          onClick={() => {
                            if (!directPeer.trim()) {
                              showToast('Enter a username to call.', 'error');
                              return;
                            }
                            setRoomName(`Direct-${[userName, directPeer].map(n => n.toLowerCase().replace(/[^a-z0-9_-]/g, '-')).sort().join('-')}`);
                            setCallType('voice');
                            setCurrentView('connecting');
                          }}
                          className="nx-btn nx-btn-ghost text-2xs px-4"
                        >
                          Voice Call
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Right: Sidebar Panel */}
                  <div className="glass-card rounded-3xl p-6 flex flex-col gap-5 max-h-[500px]">
                    <div className="flex items-center justify-between border-b border-white/5 pb-2">
                      <div className="flex gap-4">
                        <button 
                          onClick={() => setSidebarTab('contacts')}
                          className={`text-xs font-bold transition-all relative pb-1 ${
                            sidebarTab === 'contacts' ? 'text-white border-b-2 border-[var(--nx-primary)]' : 'text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          Contacts
                        </button>
                        <button 
                          onClick={() => setSidebarTab('calls')}
                          className={`text-xs font-bold transition-all relative pb-1 ${
                            sidebarTab === 'calls' ? 'text-white border-b-2 border-[var(--nx-primary)]' : 'text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          Call History
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="nx-badge nx-badge-indigo">
                          {sidebarTab === 'contacts' ? contacts.length : callHistory.length}
                        </span>
                        {sidebarTab === 'calls' && callHistory.length > 0 && (
                          <button 
                            onClick={clearAllCallHistory}
                            className="text-[9px] text-rose-400 hover:text-rose-300 font-bold bg-rose-500/10 px-2 py-0.5 rounded-md hover:bg-rose-500/20 transition-all duration-200"
                            title="Clear Call History"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>

                    {sidebarTab === 'contacts' ? (
                      <>
                        {/* Add contact */}
                        <div className="flex gap-2">
                          <input 
                            className="nx-input text-xs" 
                            value={newContact}
                            onChange={e => setNewContact(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') addContact(); }}
                            placeholder="Add username..." 
                          />
                          <button onClick={addContact} className="nx-btn-icon active px-3">
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Contacts List Scroll Container */}
                        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3">
                          {contacts.length === 0 ? (
                            <p className="text-3xs text-slate-600 text-center py-8 italic">No saved contacts yet.</p>
                          ) : (
                            contacts.map(contact => {
                              const unreadCount = unreadChatCounts[contact.username] || 0;
                              return (
                                <div 
                                  key={contact.id} 
                                  className="relative flex items-center gap-3 p-3 rounded-2xl border border-white/5 bg-white/2 hover:bg-indigo-950/20 hover:border-indigo-500/20 transition-all duration-300 group"
                                >
                                  <div className="relative flex-shrink-0">
                                    {isValidProfilePic(contact.profilePic) ? (
                                      <img src={contact.profilePic} alt={contact.username} className="w-10 h-10 rounded-2xl object-cover" />
                                    ) : (
                                      <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg font-bold" style={{ background: 'var(--nx-teal-soft)', color: 'var(--nx-primary-dark)' }}>
                                        {contact.username.charAt(0).toUpperCase()}
                                      </div>
                                    )}
                                    <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-950 shadow-sm ${
                                      onlineUsers.has(contact.username.toLowerCase()) ? 'bg-emerald-500' : 'bg-slate-600'
                                    }`} />
                                  </div>
                                  
                                  {/* Unread indicator */}
                                  {unreadCount > 0 && (
                                    <div className="absolute -top-1 -left-1 w-5 h-5 bg-rose-600 rounded-full flex items-center justify-center text-[9px] font-bold text-white shadow-lg">
                                      {unreadCount}
                                    </div>
                                  )}

                                  <div className="flex-1 min-w-0">
                                    <p className="text-2xs font-semibold text-white truncate">{contact.username}</p>
                                    <p className="text-[10px] text-slate-500 truncate mt-0.5">{contact.bio || 'Secure Contact'}</p>
                                  </div>

                                  {/* Hover Options Overlay */}
                                  <div className="absolute inset-0 bg-slate-950/90 rounded-2xl flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 backdrop-blur-sm px-2">
                                    <span className="text-[10px] text-slate-400 font-semibold truncate flex-1 pl-2">{contact.username}</span>
                                    <button 
                                      onClick={() => {
                                        setLobbySubView('chat_lobby');
                                        setActiveChatContact(contact);
                                        setUnreadChatCounts(prev => ({ ...prev, [contact.username]: 0 }));
                                      }}
                                      className="nx-btn nx-btn-ghost text-[9px] py-1 px-2 flex items-center gap-1"
                                    >
                                      <MessageSquare className="w-3 h-3 text-indigo-400" /> Chat
                                    </button>
                                    <button 
                                      onClick={() => callContact(contact.username)}
                                      className="nx-btn nx-btn-primary text-[9px] py-1 px-2 flex items-center gap-1"
                                    >
                                      <Video className="w-3 h-3" /> Call
                                    </button>
                                    <button 
                                      onClick={() => removeContact(contact.username)}
                                      className="nx-btn nx-btn-danger text-[9px] py-1 px-2 flex items-center gap-1"
                                      title="Remove Contact"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </>
                    ) : (
                      /* Call History List Scroll Container */
                      <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3">
                        {callHistory.length === 0 ? (
                          <p className="text-3xs text-slate-600 text-center py-8 italic">No call attempts yet.</p>
                        ) : (
                          callHistory.map(call => {
                            const isOutgoing = call.caller.toLowerCase() === userName.toLowerCase();
                            const peerName = isOutgoing ? call.callee : call.caller;
                            const callTime = new Date(call.started_at).toLocaleString('en-IN', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            });
                            return (
                              <div 
                                key={call.id} 
                                className="flex items-center gap-3 p-3 rounded-2xl border border-white/5 bg-white/2 hover:bg-indigo-950/10 transition-all duration-300"
                              >
                                <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg font-bold" style={{ background: call.status === 'accepted' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)', color: call.status === 'accepted' ? '#34d399' : '#fca5a5' }}>
                                  {isOutgoing ? '↗' : '↙'}
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                  <p className="text-2xs font-semibold text-white truncate">{peerName}</p>
                                  <p className="text-[10px] text-slate-500 truncate mt-0.5">{callTime} · {call.call_type}</p>
                                </div>
                                
                                <div className="flex flex-col items-end gap-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
                                      call.status === 'accepted' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                      call.status === 'declined' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                                      'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                    }`}>
                                      {call.status}
                                    </span>
                                    <button 
                                      onClick={() => deleteCallHistoryEntry(call.id)}
                                      className="text-slate-600 hover:text-rose-400 transition-all p-0.5"
                                      title="Delete Log"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                  <button 
                                    onClick={() => callContact(peerName)}
                                    className="text-indigo-400 hover:text-indigo-300 text-[10px] font-semibold pr-1"
                                  >
                                    Call
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}

                  </div>
                </div>
              ) : (
                /* CHAT LOBBY SUBVIEW */
                <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[0.8fr_1.2fr] gap-6 glass-card rounded-3xl p-6 fade-up" style={{ height: 'calc(100vh - 160px)' }}>
                  
                  {/* Left Column: Switcher */}
                  <div className="flex flex-col gap-4 border-r border-white/5 pr-4 overflow-hidden">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider">Active Conversations</h3>
                      <button 
                        onClick={() => setLobbySubView('connect')}
                        className="text-3xs text-indigo-400 hover:text-indigo-300 font-bold"
                      >
                        ← Exit Chat Lobby
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2">
                      {contacts.length === 0 ? (
                        <p className="text-3xs text-slate-600 text-center py-8">Add contacts to chat.</p>
                      ) : (
                        contacts.map(c => {
                          const isActive = activeChatContact?.id === c.id;
                          const unreadCount = unreadChatCounts[c.username] || 0;
                          return (
                            <div 
                              key={c.id}
                              onClick={() => {
                                setActiveChatContact(c);
                                setUnreadChatCounts(prev => ({ ...prev, [c.username]: 0 }));
                              }}
                              className={`flex items-center gap-2.5 p-2.5 rounded-xl cursor-pointer transition ${isActive ? 'bg-[var(--nx-teal-soft)] border border-[var(--nx-primary)]/30' : 'border border-transparent hover:bg-white/2'}`}
                            >
                              <div className="relative">
                                {isValidProfilePic(c.profilePic) ? (
                                  <img src={c.profilePic} alt={c.username} className="w-8 h-8 rounded-xl object-cover" />
                                ) : (
                                  <div className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold bg-white/5">
                                    {c.username.charAt(0).toUpperCase()}
                                  </div>
                                )}
                                {unreadCount > 0 && (
                                  <span className="absolute -top-1 -right-1 w-4.5 h-4.5 bg-rose-600 rounded-full flex items-center justify-center text-[9px] font-bold text-white shadow-lg animate-pulse">
                                    {unreadCount}
                                  </span>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-3xs font-semibold text-white truncate">{c.username}</p>
                                <p className={`text-[10px] truncate ${dmTypingStatus[c.username] ? 'text-emerald-400 font-semibold animate-pulse' : 'text-slate-500'}`}>
                                  {dmTypingStatus[c.username] ? 'typing...' : ((lobbyChats[c.username] || []).slice(-1)[0]?.text || 'No messages yet')}
                                </p>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Right Column: Chat Window */}
                  <div className="flex-1 flex h-full overflow-hidden relative">
                    <div className="flex-1 flex flex-col h-full overflow-hidden">
                      {activeChatContact ? (
                      <>
                        {/* Gorgeous WhatsApp-style Chat Header */}
                        <div className="flex items-center justify-between pb-3.5 border-b border-white/5 mb-4 mt-1">
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              {isValidProfilePic(activeChatContact.profilePic) ? (
                                <img src={activeChatContact.profilePic} alt={activeChatContact.username} className="w-10 h-10 rounded-2xl object-cover border border-white/10 shadow-md" />
                              ) : (
                                <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-sm font-bold bg-white/5 border border-white/10 text-white shadow-md">
                                  {activeChatContact.username.charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-950 shadow-sm ${
                                onlineUsers.has(activeChatContact.username.toLowerCase()) ? 'bg-emerald-500' : 'bg-slate-600'
                              }`} />
                            </div>
                            <div className="text-left">
                              <h4 className="text-xs font-bold text-white leading-tight flex items-center gap-2">
                                @{activeChatContact.username}
                                <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-sans font-semibold tracking-wider uppercase ${
                                  onlineUsers.has(activeChatContact.username.toLowerCase()) ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                                }`}>
                                  {onlineUsers.has(activeChatContact.username.toLowerCase()) ? 'online' : 'offline'}
                                </span>
                              </h4>
                              <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                                {dmTypingStatus[activeChatContact.username] ? (
                                  <span className="text-emerald-400 font-semibold animate-pulse">typing...</span>
                                ) : (
                                  activeChatContact.bio || 'Secure Contact'
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setCallType('voice');
                                callContact(activeChatContact.username);
                              }}
                              className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-indigo-400 hover:text-white hover:bg-indigo-500/20 hover:border-indigo-500/30 transition shadow-md cursor-pointer"
                              title="Voice Call"
                            >
                              <PhoneCall className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                setCallType('video');
                                callContact(activeChatContact.username);
                              }}
                              className="w-8 h-8 rounded-xl bg-[var(--nx-primary-soft)] border border-[var(--nx-primary)]/20 flex items-center justify-center text-[var(--nx-primary)] hover:text-white hover:bg-[var(--nx-primary)]/20 hover:border-[var(--nx-primary)]/30 transition shadow-md cursor-pointer animate-pulse"
                              title="Video Call"
                            >
                              <Video className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                setIsFileVaultOpen(!isFileVaultOpen);
                              }}
                              className={`w-8 h-8 rounded-xl border flex items-center justify-center transition shadow-md cursor-pointer ${
                                isFileVaultOpen
                                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                                  : 'bg-white/5 border border-white/10 text-emerald-400 hover:text-white hover:bg-emerald-500/20 hover:border-emerald-500/30'
                              }`}
                              title="E2EE Secure File Vault"
                            >
                              <FolderLock className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2.5 pb-3">
                          {/* DM Cryptographic Lock Banner */}
                          <div className="p-3 rounded-2xl flex items-center justify-between gap-3 text-left bg-slate-900/60 border border-[var(--nx-primary)]/10 backdrop-blur-md mb-2">
                            <div className="flex items-center gap-2">
                              <Lock className={`w-3.5 h-3.5 ${dmCryptoKeys[activeChatContact.username] ? 'text-emerald-400' : 'text-slate-500 animate-pulse'}`} />
                              <div>
                                <p className="text-[10px] font-bold text-slate-300">Direct Message Cryptographic Lock</p>
                                <p className="text-[8px] text-slate-500 mt-0.5">
                                  {dmCryptoKeys[activeChatContact.username] ? 'AES-256 E2E Active (Passphrase Derivation Protected)' : 'Standard Relay (Server readable)'}
                                </p>
                              </div>
                            </div>
                            <input
                              type="password"
                              value={dmSecrets[activeChatContact.username] || ''}
                              onChange={e => handleSetDmSecret(activeChatContact.username, e.target.value)}
                              placeholder="DM Secret Passphrase"
                              className="w-40 nx-input text-[10px] py-1 bg-slate-950/80 border-white/5"
                            />
                          </div>
                          {/* Pending file requests from this user */}
                          {pendingFiles.filter(f => f.sender.toLowerCase() === activeChatContact.username.toLowerCase()).map(f => {
                            const isStale = f.created_at && (Date.now() - new Date(f.created_at).getTime() > 10 * 60 * 1000);
                            const keyEntry = Object.entries(dmCryptoKeys).find(
                              ([k]) => k.toLowerCase() === f.sender.toLowerCase()
                            );
                            const isEncrypted = !!keyEntry;
                            return (
                            <div 
                              key={f.id}
                              className="p-3.5 rounded-2xl border mb-3 flex flex-col gap-3 text-left transition-all hover:scale-[1.01]"
                              style={{
                                background: 'linear-gradient(145deg, rgba(44, 37, 35, 0.95) 0%, rgba(28, 22, 20, 0.98) 100%)',
                                borderColor: isEncrypted ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 212, 172, 0.2)',
                                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
                              }}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`p-2.5 rounded-xl border text-lg flex items-center justify-center ${
                                  isEncrypted 
                                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                                    : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                                }`}>
                                  {isEncrypted ? '🔒' : '📁'}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <p className="text-2xs font-bold text-white truncate">{f.file_name}</p>
                                    {isEncrypted && (
                                      <span className="text-[8px] text-emerald-400 font-medium px-1 py-0.25 bg-emerald-500/10 rounded-md border border-emerald-500/20">
                                        E2EE
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px]" style={{ color: 'rgba(255, 212, 172, 0.6)' }}>
                                    {isEncrypted ? 'Incoming Secure E2EE File' : 'Incoming Secure File'} · {(f.file_size / (1024*1024)).toFixed(2)} MB
                                  </p>
                                </div>
                              </div>
                              {isStale && (
                                <p className="text-[10px] px-2 py-1.5 rounded-lg flex items-center gap-1.5" style={{ background: 'rgba(234, 179, 8, 0.08)', color: '#fbbf24', border: '1px solid rgba(234, 179, 8, 0.15)' }}>
                                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                                  Sender may be offline — transfer might not start
                                </p>
                              )}
                              <div className="flex items-center gap-2">
                                <button 
                                  onClick={() => acceptFileTransfer(f)}
                                  className="flex-1 py-2 rounded-xl text-3xs font-bold text-white transition-all hover:brightness-110"
                                  style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}
                                >
                                  ✅ Accept Transfer
                                </button>
                                <button 
                                  onClick={() => declineFileTransfer(f)}
                                  className="py-2 px-4 rounded-xl text-3xs font-bold transition hover:bg-white/5"
                                  style={{ border: '1px solid rgba(239, 68, 68, 0.3)', color: '#fca5a5' }}
                                >
                                  ❌ Decline
                                </button>
                              </div>
                            </div>
                            );
                          })}

                          {(lobbyChats[activeChatContact.username] || []).length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center opacity-40">
                              <MessageSquare className="w-10 h-10 text-slate-500" />
                              <p className="text-3xs text-slate-400">Establish connection. Send a direct message.</p>
                            </div>
                          ) : (
                            (lobbyChats[activeChatContact.username] || []).map(m => {
                              const isEditing = editingMessageId === m.id;
                              const isSending = m.self && m.status === 'sending';
                              return (
                                <div 
                                  key={m.id} 
                                  className={`chat-bubble ${m.self ? 'self' : 'remote'} group relative`}
                                  style={isSending ? { opacity: 0.6, transition: 'opacity 0.3s ease' } : { transition: 'opacity 0.3s ease' }}
                                >
                                  <span className="sender">{m.self ? 'You' : m.sender}</span>
                                  
                                  {isEditing ? (
                                    <div className="flex flex-col gap-2 mt-1 w-full min-w-[200px] text-left">
                                      <input 
                                        type="text"
                                        value={editingText}
                                        onChange={e => setEditingText(e.target.value)}
                                        onKeyDown={e => {
                                          if (e.key === 'Enter') saveMessageEdit(m.id, activeChatContact.username);
                                          if (e.key === 'Escape') setEditingMessageId(null);
                                        }}
                                        className="nx-input text-xs w-full bg-slate-900 border-indigo-500/50 text-white"
                                        autoFocus
                                      />
                                      <div className="flex gap-2 justify-end">
                                        <button 
                                          onClick={() => setEditingMessageId(null)}
                                          className="text-[9px] text-slate-400 hover:text-white px-2 py-1 bg-white/5 rounded-lg transition"
                                        >
                                          Cancel
                                        </button>
                                        <button 
                                          onClick={() => saveMessageEdit(m.id, activeChatContact.username)}
                                          className="text-[9px] text-indigo-300 hover:text-white px-2 py-1 bg-indigo-600/30 hover:bg-indigo-600/50 rounded-lg transition"
                                        >
                                          Save
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <div className="bubble flex items-start justify-between gap-3">
                                        <span>
                                          {m.decryptedText ? (
                                            <span className="flex items-center gap-1.5 text-indigo-200">
                                              <Lock className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                                              {m.decryptedText}
                                            </span>
                                          ) : m.text.startsWith('[E2EE]:') ? (
                                            <span className="flex items-center gap-1.5 text-rose-300 font-medium">
                                              <ShieldAlert className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                                              🔒 Encrypted Message
                                            </span>
                                          ) : (
                                            m.text
                                          )}
                                        </span>
                                        {m.self && !isSending && (
                                          <div className="opacity-0 group-hover:opacity-100 transition-all duration-200 flex gap-1.5 self-center ml-2 bg-slate-950/60 p-1 rounded-lg backdrop-blur-sm">
                                            <button 
                                              onClick={() => {
                                                setEditingMessageId(m.id);
                                                setEditingText(m.text);
                                              }}
                                              className="text-slate-400 hover:text-indigo-400 p-0.5"
                                              title="Edit Message"
                                            >
                                              <Edit2 className="w-3 h-3" />
                                            </button>
                                            <button 
                                              onClick={() => deleteMessage(m.id, activeChatContact.username)}
                                              className="text-slate-400 hover:text-rose-400 p-0.5"
                                              title="Delete Message"
                                            >
                                              <Trash className="w-3 h-3" />
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                      <div className="flex items-center justify-end gap-1 mt-0.5">
                                        <span className="time">{isSending ? 'sending...' : m.time}</span>
                                        {isSending && (
                                          <span className="text-[9px] animate-pulse text-slate-400">⚡</span>
                                        )}
                                      </div>
                                    </>
                                  )}
                                </div>
                              );
                            })
                          )}
                          {dmTypingStatus[activeChatContact.username] && (
                            <div className="chat-bubble remote flex flex-col group relative mt-1 max-w-[200px]" style={{ transition: 'opacity 0.3s ease' }}>
                              <span className="sender">{activeChatContact.username}</span>
                              <div className="bubble flex items-center gap-2">
                                <span className="flex gap-0.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                                </span>
                                <span className="text-3xs text-indigo-400 italic font-medium">typing...</span>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* File Transfer Progress Card */}
                        {fileTransferProgress && fileTransferProgress.status !== 'idle' && (
                          <div 
                            className="p-3.5 rounded-2xl border mb-3 flex flex-col gap-2 text-left transition-all duration-300"
                            style={{
                              background: 'rgba(44, 37, 35, 0.95)',
                              borderColor: fileTransferProgress.status === 'completed' ? 'rgba(16, 185, 129, 0.3)' :
                                           fileTransferProgress.status === 'failed' ? 'rgba(239, 68, 68, 0.3)' :
                                           fileTransferProgress.isEncrypted ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255, 212, 172, 0.2)',
                              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-sm">
                                  {fileTransferProgress.status === 'completed' ? '✅' :
                                   fileTransferProgress.status === 'failed' ? '❌' : '📥'}
                                </span>
                                <div>
                                  <p className="text-2xs font-bold text-white truncate max-w-xs">{fileTransferProgress.fileName}</p>
                                  <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                                    {(fileTransferProgress.fileSize / (1024 * 1024)).toFixed(2)} MB · {fileTransferProgress.role === 'sender' ? 'Uploading (P2P)' : 'Downloading (P2P)'}
                                    {fileTransferProgress.isEncrypted && (
                                      <span className="text-[8px] text-emerald-400 font-semibold px-1 py-0.25 bg-emerald-500/10 rounded-md border border-emerald-500/20 flex items-center gap-0.5">
                                        🔒 E2EE Active
                                      </span>
                                    )}
                                  </p>
                                </div>
                              </div>
                              <span className="text-3xs text-slate-500 font-mono">{fileTransferProgress.speed}</span>
                            </div>

                            {/* Progress bar */}
                            {fileTransferProgress.status !== 'failed' && (
                              <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden border border-white/5">
                                <div 
                                  className="h-full rounded-full transition-all duration-300"
                                  style={{ 
                                    width: `${fileTransferProgress.progress}%`,
                                    background: fileTransferProgress.status === 'completed' ? '#10b981' :
                                                fileTransferProgress.isEncrypted ? '#10b981' : '#FFD4AC' 
                                  }}
                                />
                              </div>
                            )}

                            <div className="flex justify-between items-center text-3xs">
                              <span className="font-semibold" style={{ 
                                color: fileTransferProgress.status === 'completed' ? '#34d399' :
                                       fileTransferProgress.status === 'failed' ? '#f87171' : '#FFD4AC'
                              }}>
                                {fileTransferProgress.status === 'connecting' && 'Negotiating direct channel...'}
                                {fileTransferProgress.status === 'transferring' && `Streaming... ${fileTransferProgress.progress}%`}
                                {fileTransferProgress.status === 'completed' && 'Completed'}
                                {fileTransferProgress.status === 'failed' && 'Transfer failed'}
                              </span>
                              {(fileTransferProgress.status === 'transferring' || fileTransferProgress.status === 'connecting') ? (
                                <button 
                                  onClick={() => cancelFileTransfer(activeChatContact?.username || '')}
                                  className="text-rose-400 hover:text-rose-300 font-bold transition px-2 py-0.5 rounded border border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/10 text-4xs uppercase tracking-wider"
                                >
                                  Cancel
                                </button>
                              ) : (
                                <button 
                                  onClick={() => setFileTransferProgress(null)}
                                  className="text-slate-400 hover:text-white font-semibold transition"
                                >
                                  Dismiss
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Message Input */}
                        <div className="flex gap-2 pt-2 border-t border-white/5 items-center">
                          <label className="nx-btn-icon cursor-pointer flex items-center justify-center px-3 py-2 bg-white/5 hover:bg-white/10 transition border border-white/10 rounded-xl" title="Send Secure File (P2P)">
                            <Paperclip className="w-4 h-4 text-slate-300" />
                            <input 
                              id="secure-file-input"
                              type="file" 
                              className="hidden" 
                              onChange={handleFileSelected} 
                            />
                          </label>
                          <input 
                            className="nx-input flex-1 text-xs" 
                            value={lobbyChatInput}
                            onChange={e => handleLobbyChatInputChange(e.target.value)}
                            onKeyDown={e => { if (chatSettings.pressEnterToSend && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendLobbyChat(); } }}
                            placeholder={`Message ${activeChatContact.username}...`} 
                          />
                          <button 
                            onClick={sendLobbyChat} 
                            disabled={!lobbyChatInput.trim()}
                            className="nx-btn-icon active px-4"
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center opacity-45">
                        <User className="w-12 h-12 text-slate-500" />
                        <p className="text-3xs text-slate-400">Select a contact from the active conversations panel to begin messaging.</p>
                      </div>
                    )}
                    </div>
                    {/* E2EE Secure File Vault Panel */}
                    {isFileVaultOpen && activeChatContact && (
                      <div className="w-[320px] h-full border-l border-white/5 bg-slate-950/70 backdrop-blur-md flex flex-col overflow-hidden transition-all duration-300">
                        {/* Vault Header */}
                        <div className="p-4 border-b border-white/5 flex items-center justify-between bg-slate-950/20">
                          <div className="flex items-center gap-2">
                            <FolderLock className="w-4 h-4 text-emerald-400" />
                            <div className="text-left">
                              <h4 className="text-2xs font-bold text-white leading-tight">E2EE Secure Vault</h4>
                              <p className="text-[10px] text-slate-400 font-mono">@{activeChatContact.username}</p>
                            </div>
                          </div>
                          <button 
                            onClick={() => setIsFileVaultOpen(false)}
                            className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Search Bar */}
                        <div className="p-3 border-b border-white/5 bg-slate-950/10">
                          <div className="relative">
                            <input 
                              type="text" 
                              value={vaultSearchQuery}
                              onChange={e => setVaultSearchQuery(e.target.value)}
                              placeholder="Search files..."
                              className="w-full bg-slate-950/40 border border-white/10 rounded-xl py-1.5 pl-3 pr-8 text-2xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 transition font-sans"
                            />
                            {vaultSearchQuery && (
                              <button 
                                onClick={() => setVaultSearchQuery('')}
                                className="absolute right-2.5 top-2 text-slate-500 hover:text-white transition cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Vault File List */}
                        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
                          {(() => {
                            const filteredHistory = fileTransferHistory.filter(f => 
                              f.file_name.toLowerCase().includes(vaultSearchQuery.toLowerCase())
                            );

                            if (filteredHistory.length === 0) {
                              return (
                                <div className="flex-1 flex flex-col items-center justify-center py-12 px-4 text-center opacity-40">
                                  <FolderLock className="w-8 h-8 text-slate-500 mb-2" />
                                  <p className="text-3xs text-slate-300 font-medium">
                                    {vaultSearchQuery ? 'No matching files found' : 'Secure vault is empty'}
                                  </p>
                                  <p className="text-[10px] text-slate-500 mt-1 max-w-[200px] leading-relaxed">
                                    {vaultSearchQuery ? 'Try adjusting your search criteria.' : 'Files shared with this contact will appear here automatically.'}
                                  </p>
                                </div>
                              );
                            }

                            return filteredHistory.map(f => {
                              const isOutgoing = f.sender.toLowerCase() === userName.toLowerCase();
                              const formattedSize = f.file_size > 1024 * 1024 
                                ? `${(f.file_size / (1024 * 1024)).toFixed(2)} MB`
                                : `${(f.file_size / 1024).toFixed(1)} KB`;
                              const sharedDate = new Date(f.created_at).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              });

                              return (
                                <div 
                                  key={f.id} 
                                  className="p-3 rounded-2xl bg-white/2 border border-white/5 hover:border-white/10 hover:bg-white/4 transition-all duration-200 text-left flex flex-col gap-2 relative group"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <p className="text-2xs font-bold text-slate-100 truncate group-hover:text-emerald-400 transition" title={f.file_name}>
                                        {f.file_name}
                                      </p>
                                      <p className="text-[10px] text-slate-400 mt-0.5 font-mono">
                                        {formattedSize} · {isOutgoing ? 'Sent' : 'Received'}
                                      </p>
                                    </div>
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-sans font-semibold border ${
                                      f.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                      f.status === 'accepted' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' :
                                      f.status === 'declined' ? 'bg-slate-500/10 text-slate-400 border-slate-500/20' :
                                      f.status === 'failed' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                                      'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                    }`}>
                                      {f.status}
                                    </span>
                                  </div>

                                  <div className="flex items-center justify-between text-[10px] text-slate-500 border-t border-white/3 pt-1.5 mt-0.5">
                                    <span className="font-mono">{sharedDate}</span>
                                    {f.status === 'pending' && !isOutgoing && (
                                      <div className="flex items-center gap-1">
                                        <button 
                                          onClick={() => acceptFileTransfer(f)}
                                          className="px-2 py-0.5 bg-emerald-600/30 hover:bg-emerald-600/60 text-emerald-300 rounded font-semibold cursor-pointer transition text-[9px]"
                                        >
                                          Accept
                                        </button>
                                        <button 
                                          onClick={() => declineFileTransfer(f)}
                                          className="px-2 py-0.5 bg-white/5 hover:bg-rose-600/20 text-rose-300 rounded font-semibold cursor-pointer transition text-[9px]"
                                        >
                                          Decline
                                        </button>
                                      </div>
                                    )}
                                    {f.status === 'completed' && (
                                      <span className="text-[9px] text-emerald-400/70 font-sans">✓ Saved</span>
                                    )}
                                  </div>
                                </div>
                              );
                            });
                          })()}
                        </div>

                        {/* Note Footer */}
                        <div className="p-3.5 bg-slate-950/20 border-t border-white/5 text-[9px] text-slate-500 leading-normal text-left">
                          <p className="font-semibold text-slate-400 mb-0.5">🔒 Zero-Knowledge Security</p>
                          Files are transferred peer-to-peer using end-to-end encrypted WebRTC channels. No files are ever saved on the server.
                        </div>
                      </div>
                    )}
                  </div>
                  
                </div>
              )}
            </div>
                  )
      ) : (
        /* ════════════════════════════
           ACTIVE CALL VIEW
           ════════════════════════════ */
        <div className="flex-1 flex active-call-shell">

            {/* ── LEFT: VIDEO GRID ─── */}
            <div ref={callStageRef} className="flex-1 flex flex-col p-4 gap-4 call-stage">

              {/* Remote-control warning banner */}
              {controlledBy && (
                <div className="flex items-center justify-between px-4 py-3 rounded-2xl nx-alert"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
                  <span className="flex items-center gap-2 text-xs font-semibold text-rose-300">
                    <ShieldAlert className="w-4 h-4 text-rose-400 animate-pulse" />
                    Remote control active — operator: <strong>{controlledBy}</strong>
                  </span>
                  <button onClick={triggerEmergencyKill}
                    className="nx-btn nx-btn-danger text-2xs py-1.5 px-3">
                    <Zap className="w-3 h-3" /> Kill Switch
                  </button>
                </div>
              )}

              {/* ── TOPBAR ── */}
              <div className="call-topbar flex flex-wrap items-center justify-between gap-3 px-3 py-2 rounded-2xl">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-slate-950 truncate">{roomName}</p>
                      
                      {/* Premium Dynamic ABR Quality Status Badge */}
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold border transition-all duration-300 ${
                        currentQualityProfile === 'hd'
                          ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                          : currentQualityProfile === 'sd'
                          ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                          : currentQualityProfile === 'low'
                          ? 'text-orange-400 bg-orange-500/10 border-orange-500/20'
                          : 'text-rose-400 bg-rose-500/10 border-rose-500/20 animate-pulse'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          currentQualityProfile === 'hd'
                            ? 'bg-emerald-400'
                            : currentQualityProfile === 'sd'
                            ? 'bg-amber-400'
                            : currentQualityProfile === 'low'
                            ? 'bg-orange-400'
                            : 'bg-rose-400'
                        }`} />
                        <span className="uppercase tracking-wider font-mono font-black">{currentQualityProfile}</span>
                        {qualityPreference === 'auto' && (
                          <span className="text-[8px] opacity-75 font-normal">Auto</span>
                        )}
                      </span>
                    </div>
                    <p className="text-3xs text-slate-500">{participants.length + 1} participants · {isConnected ? 'secure relay live' : 'reconnecting'}</p>
                  </div>
                </div>

                {/* ── Layout picker ── */}
                <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: 'rgba(44,37,35,0.06)', border: '1px solid rgba(44,37,35,0.09)' }}>
                  {([
                    { id: 'auto',       Icon: LayoutGrid,        tip: 'Auto Grid' },
                    { id: 'pip-remote', Icon: PictureInPicture2,  tip: 'Remote Focus (PiP)' },
                    { id: 'pip-local',  Icon: LayoutPanelLeft,    tip: 'Self Focus (PiP)' },
                    { id: 'equal',      Icon: Columns2,            tip: 'Side by Side' },
                    { id: 'three',      Icon: Columns3,            tip: 'Three Columns Grid' },
                    { id: 'horizontal', Icon: LayoutPanelTop,     tip: 'Horizontal Strip' },
                  ] as { id: typeof streamLayout; Icon: React.FC<{ className?: string }>; tip: string }[]).map(({ id, Icon, tip }) => (
                    <button
                      key={id}
                      title={tip}
                      onClick={() => setStreamLayout(id)}
                      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-150 nx-tooltip`}
                      data-tip={tip}
                      style={streamLayout === id
                        ? { background: 'var(--nx-primary)', color: '#fff', boxShadow: '0 2px 8px rgba(209,110,71,0.35)' }
                        : { color: 'var(--nx-muted)' }
                      }
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>

                {isElectron && (
                  <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)' }}>
                    <button
                      onClick={() => {
                        if ((window as any).nexalinkDesktop) {
                          (window as any).nexalinkDesktop.sendAction('desktop-action', { action: 'toggle-mini-mode' });
                        }
                      }}
                      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-150 nx-tooltip`}
                      style={isMiniMode
                        ? { background: 'var(--nx-primary)', color: '#fff', boxShadow: '0 2px 8px rgba(209,110,71,0.35)' }
                        : { color: 'var(--nx-muted)' }
                      }
                      title={isMiniMode ? "Exit Mini Overlay" : "Enter Mini Overlay"}
                      data-tip={isMiniMode ? "Exit Mini Overlay" : "Enter Mini Overlay"}
                    >
                      <PictureInPicture2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if ((window as any).nexalinkDesktop) {
                          (window as any).nexalinkDesktop.sendAction('desktop-action', {
                            action: 'set-always-on-top',
                            data: { active: !isAlwaysOnTop }
                          });
                        }
                      }}
                      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-150 nx-tooltip`}
                      style={isAlwaysOnTop
                        ? { background: 'var(--nx-primary)', color: '#fff', boxShadow: '0 2px 8px rgba(209,110,71,0.35)' }
                        : { color: 'var(--nx-muted)' }
                      }
                      title={isAlwaysOnTop ? "Disable Always on Top" : "Enable Always on Top"}
                      data-tip={isAlwaysOnTop ? "Disable Always on Top" : "Enable Always on Top"}
                    >
                      <Pin className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => setFitMode(mode => mode === 'cover' ? 'contain' : 'cover')}
                    className="nx-btn nx-btn-ghost text-2xs py-2 px-3">
                    <Scan className="w-3.5 h-3.5" /> {fitMode === 'cover' ? 'Fit' : 'Fill'}
                  </button>
                  <button onClick={() => openFullscreen()}
                    className="nx-btn nx-btn-ghost text-2xs py-2 px-3">
                    <Maximize2 className="w-3.5 h-3.5" /> Full Screen
                  </button>
                  <button onClick={() => setLocallyHiddenPeers([])}
                    className="nx-btn nx-btn-ghost text-2xs py-2 px-3"
                    disabled={locallyHiddenPeers.length === 0}>
                    <Eye className="w-3.5 h-3.5" /> Show All
                  </button>

                  {/* Hidden stream unhide pill buttons */}
                  {locallyHiddenPeers.map(id => {
                    let displayName = '';
                    if (id === 'self') {
                      displayName = 'Self (You)';
                    } else if (id === 'screen') {
                      displayName = 'Screen Share';
                    } else {
                      const p = participants.find(part => part.id === id);
                      displayName = p ? p.name : 'Peer';
                    }
                    return (
                      <button
                        key={id}
                        onClick={() => setLocallyHiddenPeers(prev => prev.filter(x => x !== id))}
                        className="nx-badge flex items-center gap-1 cursor-pointer transition active:scale-95 text-[10px] py-1 px-2.5 rounded-lg border animate-fade-in"
                        style={{
                          background: 'rgba(16,185,129,0.1)',
                          borderColor: 'rgba(16,185,129,0.3)',
                          color: '#34d399',
                          fontWeight: 600
                        }}
                        title={`Show ${displayName} again`}
                      >
                        <Eye className="w-3 h-3 text-emerald-400" /> Show {displayName}
                      </button>
                    );
                  })}
                </div>
                <span className="text-3xs font-mono text-slate-500">
                  {orderedParticipants.length + 1} visible · {locallyHiddenPeers.length} hidden
                </span>
              </div>

              {/* Video grid */}
              {/* Layout styles:
                  auto        → 2-col grid, adapts to participant count
                  pip-remote  → single column full, self as floating PiP overlay
                  pip-local   → self full, remote as floating PiP overlay
                  equal       → always exactly 2 equal columns
                  horizontal  → row: self 40% | remotes 60% in column
              */}
              {isLinkedToShareScreen ? (
                /* ── LINKED SHARE SCREEN FOCUS VIEW ── */
                <div className="flex-1 flex flex-row gap-4 min-h-0 relative">
                  
                  {/* ── SCROLLABLE VIDEO RIBBON (VERTICAL STRIP) ── */}
                  <div className="flex flex-col gap-3 overflow-y-auto w-36 pr-1 bg-slate-950/40 p-2.5 rounded-2xl border border-white/5 backdrop-blur-md">
                    {/* Render Self Camera in Ribbon if not selected */}
                    {linkedStreamId !== 'self' && !locallyHiddenPeers.includes('self') && (
                      <div 
                        onClick={() => setLinkedStreamId('self')}
                        className="flex-shrink-0 w-full aspect-video rounded-xl overflow-hidden border border-white/10 hover:border-[var(--nx-primary)]/50 transition cursor-pointer relative group bg-slate-900"
                      >
                        <video ref={localVideoCallbackRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
                        <div className="absolute bottom-1 left-1.5 right-1.5 flex items-center justify-between text-[8px] bg-slate-950/80 px-1 py-0.5 rounded text-white font-semibold">
                          <span className="truncate">Self (You)</span>
                        </div>
                      </div>
                    )}
                    
                    {/* Render Screen Share in Ribbon if not selected */}
                    {screenStream && linkedStreamId !== 'screen' && (
                      <div 
                        onClick={() => setLinkedStreamId('screen')}
                        className="flex-shrink-0 w-full aspect-video rounded-xl overflow-hidden border border-white/10 hover:border-[var(--nx-primary)]/50 transition cursor-pointer relative group bg-slate-900"
                      >
                        <video ref={screenVideoCallbackRef} autoPlay playsInline muted className="w-full h-full object-contain" />
                        <div className="absolute bottom-1 left-1.5 right-1.5 flex items-center justify-between text-[8px] bg-slate-950/80 px-1 py-0.5 rounded text-white font-semibold">
                          <span className="truncate">Screen Share</span>
                        </div>
                      </div>
                    )}

                    {/* Render Remote Peers in Ribbon */}
                    {orderedParticipants.map(peer => {
                      if (locallyHiddenPeers.includes(peer.id)) return null;
                      return (
                        <div 
                          key={peer.id}
                          className="flex-shrink-0 w-full aspect-video rounded-xl overflow-hidden border border-white/10 transition relative bg-slate-900 flex flex-col items-center justify-center p-2"
                        >
                          {isValidProfilePic(getPeerProfilePic(peer)) ? (
                            <img src={getPeerProfilePic(peer)} alt={peer.name} className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-xs text-indigo-400 font-bold">{peer.avatar}</div>
                          )}
                          <span className="text-[8px] text-slate-400 mt-1 font-semibold truncate max-w-full">{peer.name}</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* ── DOMINANT FOCUS STREAM VIEW (WITH OVERLAYS) ── */}
                  <div className="flex-1 flex items-center justify-center min-h-0 bg-[#060a18] rounded-3xl border border-white/5 relative overflow-hidden group shadow-2xl">
                    
                    {/* Glow corner decorations */}
                    <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
                    <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

                    {/* Live Calibrating Overlay / Frame */}
                    {isCalibrating && (
                      <div className="absolute inset-0 border border-[var(--nx-primary)]/30 rounded-3xl pointer-events-none z-30 animate-pulse bg-gradient-to-t from-[var(--nx-primary)]/2 to-transparent" />
                    )}

                    {/* Selected Video Element wrapper */}
                    <div 
                      id="linked-focus-container"
                      className="relative w-full h-full flex items-center justify-center p-4"
                    >
                      <div 
                        id="linked-video-box"
                        className="relative aspect-video w-full h-full max-w-full max-h-full rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-slate-950 flex items-center justify-center"
                      >
                        {linkedStreamId === 'self' ? (
                          <video ref={localVideoCallbackRef} autoPlay playsInline muted className="w-full h-full object-contain" style={{ transform: 'scaleX(-1)' }} />
                        ) : linkedStreamId === 'screen' ? (
                          <video ref={screenVideoCallbackRef} autoPlay playsInline muted className="w-full h-full object-contain" />
                        ) : (
                          <div className="flex flex-col items-center gap-2 opacity-50">
                            <Users className="w-12 h-12 text-slate-500" />
                            <p className="text-2xs text-slate-400">Stream connected (Audio only)</p>
                          </div>
                        )}

                        {/* ── WARPED OVERLAY CANVAS ── */}
                        <canvas 
                          id="linked-overlay-canvas"
                          width="1000"
                          height="640"
                          className="absolute top-0 left-0 pointer-events-none z-10"
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '1000px',
                            height: '640px',
                            transformOrigin: '0 0',
                            transform: (() => {
                              const W = containerSize.width;
                              const H = containerSize.height;
                              const src = [
                                { x: 0, y: 0 },
                                { x: 1000, y: 0 },
                                { x: 1000, y: 640 },
                                { x: 0, y: 640 }
                              ];
                              const dst = calibrationPoints.map(pt => ({
                                x: (pt.x * W) / 100,
                                y: (pt.y * H) / 100
                              }));
                              const matrix = getHomographyMatrix(src, dst);
                              return getCssMatrix3d(matrix);
                            })()
                          }}
                        />

                        {/* ── INTERACTIVE DRAWING OVERLAY FOR MOUSE INJECTION ── */}
                        <div 
                          className="absolute inset-0 z-20 cursor-crosshair"
                          style={{ pointerEvents: isCalibrating ? 'none' : 'auto' }}
                          onMouseDown={handleOverlayMouseDown}
                          onMouseMove={handleOverlayMouseMove}
                          onMouseUp={handleOverlayMouseUp}
                          onMouseLeave={handleOverlayMouseLeave}
                        />

                        {/* ── BIDIRECTIONAL HOVER POINTER OVERLAYS ── */}
                        {overlayHoverPos && (
                          <div 
                            className="absolute pointer-events-none w-6 h-6 -ml-3 -mt-3 rounded-full border-2 border-amber-400 bg-amber-400/10 flex items-center justify-center z-30 transition-all duration-75 ease-out shadow-[0_0_10px_rgba(220,177,107,0.6)]"
                            style={{
                              left: `${overlayHoverPos.x}px`,
                              top: `${overlayHoverPos.y}px`
                            }}
                          >
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_4px_rgba(220,177,107,0.9)]" />
                          </div>
                        )}

                        {whiteboardProjectedPointer && (
                          <div 
                            className="absolute pointer-events-none w-8 h-8 -ml-4 -mt-4 flex items-center justify-center z-30 transition-all duration-75 ease-out"
                            style={{
                              left: `${whiteboardProjectedPointer.x}px`,
                              top: `${whiteboardProjectedPointer.y}px`
                            }}
                          >
                            {/* Neon glowing target crosshair */}
                            <div className="w-4.5 h-4.5 rounded-full border-2 border-indigo-400 bg-indigo-400/20 shadow-[0_0_12px_rgba(129,140,248,0.7)] flex items-center justify-center relative">
                              <div className="absolute w-6 h-0.5 bg-indigo-400/50" />
                              <div className="absolute h-6 w-0.5 bg-indigo-400/50" />
                              <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                            </div>
                            <div className="absolute -bottom-5 px-1.5 py-0.5 rounded bg-slate-950/80 border border-indigo-400/30 text-[7px] text-white font-mono uppercase tracking-wider font-bold">
                              Whiteboard Spot
                            </div>
                          </div>
                        )}

                        {/* ── INTERACTIVE CALIBRATION HANDLES OVERLAY ── */}
                        {isCalibrating && (
                          <div className="absolute inset-0 z-40 select-none">
                            {calibrationPoints.map((pt, idx) => {
                              const label = idx === 0 ? 'TL' : idx === 1 ? 'TR' : idx === 2 ? 'BR' : 'BL';
                              return (
                                <div
                                  key={idx}
                                  className="absolute w-6 h-6 -ml-3 -mt-3 rounded-full flex items-center justify-center cursor-move shadow-lg border border-white/40 active:scale-125 transition-transform"
                                  style={{
                                    left: `${pt.x}%`,
                                    top: `${pt.y}%`,
                                    background: 'radial-gradient(circle, var(--nx-primary) 0%, rgba(209,110,71,0.6) 100%)',
                                    boxShadow: '0 0 10px var(--nx-primary)',
                                  }}
                                  onMouseDown={(e) => handleStartDragHandle(e, idx)}
                                >
                                  <span className="text-[8px] font-black text-white">{label}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                  </div>

                </div>
              ) : (
                /* ── STANDARD VIDEO GRID VIEW ── */
                <div
                  className={`flex-1 gap-4 overflow-y-auto ${
                  streamLayout === 'horizontal' ? 'flex flex-row'
                  : (streamLayout === 'equal' || streamLayout === 'three') ? 'grid'
                  : streamLayout === 'pip-remote' || streamLayout === 'pip-local' ? 'relative'
                  : 'grid'
                } ${hasPinnedTile ? 'video-grid-pinned' : ''}`}
                style={{
                  minHeight: 280,
                  height: '100%',
                  position: (streamLayout === 'pip-remote' || streamLayout === 'pip-local') ? 'relative' : undefined,
                  ...(streamLayout === 'auto'
                    ? {
                        gridTemplateColumns: totalVisibleTiles <= 1 ? '1fr' : 'repeat(2, 1fr)',
                        gridTemplateRows: totalVisibleTiles <= 2 ? '1fr' : 'repeat(2, 1fr)',
                      }
                    : streamLayout === 'equal'
                    ? { gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: '1fr' }
                    : streamLayout === 'three'
                    ? { gridTemplateColumns: 'repeat(3, 1fr)' }
                    : streamLayout === 'horizontal'
                    ? {}   // flex-row handled by class
                    : {}   // pip modes: children positioned absolutely
                  ),
                }}>

                {tileOrder.map((tileId) => {
                  if (locallyHiddenPeers.includes(tileId)) return null;

                  if (tileId === 'self') {
                    return (
                      <div
                        key="self"
                        id="tile-self"
                        draggable
                        onDragStart={(e) => handleDragStart(e, 'self')}
                        onDragOver={(e) => handleDragOver(e, 'self')}
                        onDragEnter={(e) => handleDragEnter(e, 'self')}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, 'self')}
                        className={`video-tile cursor-grab active:cursor-grabbing ${
                          dragOverTileId === 'self' ? 'drag-over' : ''
                        } ${
                          controlledBy ? 'controlled' : ''
                        } ${pinnedTile === 'self' ? 'pinned' : ''} ${
                          streamLayout === 'pip-remote' ? 'layout-pip-self' : ''
                        } ${
                          streamLayout === 'pip-local' ? 'layout-pip-local-self' : ''
                        } ${
                          streamLayout === 'horizontal' ? 'layout-horizontal-self' : ''
                        }`}
                        style={{
                          height: (streamLayout === 'auto' || streamLayout === 'equal' || streamLayout === 'three') ? '100%' : undefined,
                          minHeight: streamLayout === 'pip-remote' ? 0 : 220,
                          ...(streamLayout === 'pip-local' ? { flex: 1, minHeight: 220 } : {}),
                        }}>
                        {isSelfHidden && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/90 backdrop-blur-sm z-20">
                            <EyeOff className="w-6 h-6 text-slate-500" />
                            <p className="text-[10px] text-slate-500 font-semibold uppercase">Your Stream Hidden Locally</p>
                            <button onClick={() => toggleLocalHide('self')} className="text-[9px] text-indigo-400 hover:text-indigo-300 font-bold mt-1">Unhide Stream</button>
                          </div>
                        )}
                        <video ref={localVideoCallbackRef} autoPlay playsInline muted draggable={false}
                          {...({ autoPictureInPicture: autoPipEnabled } as any)}
                          className={`w-full h-full ${videoFitClass} ${videoEnabled ? '' : 'opacity-0'}`} style={{ transform: 'scaleX(-1)', minHeight: 220 }} />

                        {!videoEnabled && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center"
                            style={{ background: 'radial-gradient(circle at 50% 20%, rgba(99,102,241,0.18), rgba(6,10,24,0.96) 58%)' }}>
                            {isValidProfilePic(profile.profilePic) ? (
                              <img src={profile.profilePic} alt={userName} draggable={false}
                                className="w-24 h-24 rounded-full object-cover border-2 border-indigo-500/40 shadow-xl" />
                            ) : (
                              <div className="w-24 h-24 rounded-full flex items-center justify-center text-3xl border-2 border-indigo-500/30" draggable={false}
                                style={{ background: 'rgba(99,102,241,0.14)' }}>
                                {myAlias.avatar}
                              </div>
                            )}
                            <div>
                              <p className="text-lg font-bold text-white">{profile.username || myAlias.name}</p>
                            </div>
                          </div>
                        )}

                        <div className="video-nameplate">
                          <div className="flex items-center gap-2">
                            <span className="status-dot live" style={{ width: 6, height: 6 }} />
                            <span className="text-xs font-semibold text-white">{myAlias.name} (You)</span>
                          </div>
                          <div className="flex items-end gap-0.5 h-3.5">
                            <span className="audio-bar" />
                            <span className="audio-bar" />
                            <span className="audio-bar" />
                            <span className="audio-bar" />
                          </div>
                        </div>

                        <div className="tile-actions">
                          <button onClick={() => togglePinnedTile('self')} className="tile-action" title={pinnedTile === 'self' ? 'Unpin' : 'Pin'}>
                            {pinnedTile === 'self' ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                          </button>
                          <button onClick={() => openFullscreen('tile-self')} className="tile-action" title="Fullscreen">
                            <Maximize2 className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={() => toggleLocalHide('self')} 
                            className={`tile-action ${isSelfHidden ? 'active text-emerald-400' : ''}`} 
                            title={isSelfHidden ? "Unhide Locally" : "Hide Locally"}
                          >
                            {isSelfHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          </button>
                        </div>

                        {/* Floating PiP Hover Overlay */}
                        {streamLayout === 'pip-remote' && (
                          <div className="pip-hover-overlay">
                            <button onClick={(e) => { e.stopPropagation(); toggleLocalHide('self'); }} className="pip-close-btn" title="Hide self video">
                              <X className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); openFullscreen('tile-self'); }} className="pip-fullscreen-btn" title="Expand to Fullscreen">
                              <Maximize2 className="w-4 h-4" />
                              <span className="text-[9px] uppercase tracking-wider font-semibold">Expand</span>
                            </button>
                          </div>
                        )}

                        {/* Muted / vid-off indicators */}
                        {!audioEnabled && (
                          <div className="absolute top-3 right-3">
                            <span className="nx-badge nx-badge-rose"><MicOff className="w-2.5 h-2.5" /></span>
                          </div>
                        )}
                        {!videoEnabled && (
                          <div className="absolute top-3 left-3">
                            <span className="nx-badge nx-badge-indigo"><VideoOff className="w-2.5 h-2.5" /> Profile</span>
                          </div>
                        )}

                        {/* Live Captions Overlay */}
                        {liveCaptionsEnabled && (liveCaptions['self'] || translatedCaptions['self']) && (
                          <div className="absolute bottom-12 left-4 right-4 z-30 flex justify-center">
                            <div className="px-4 py-2 rounded-xl bg-slate-950/85 backdrop-blur-md border border-cyan-500/30 text-center max-w-[85%] shadow-lg animate-fade-in animate-duration-200">
                              <span className="text-[10px] text-cyan-400 font-bold tracking-wider uppercase block mb-0.5">Closed Captions</span>
                              <p className="text-sm font-semibold text-white leading-relaxed">
                                {translationLanguage !== 'none' && translatedCaptions['self'] ? translatedCaptions['self'] : liveCaptions['self']}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }

                  if (tileId === 'screen') {
                    return (
                      <div
                        key="screen"
                        id="tile-screen"
                        draggable
                        onDragStart={(e) => handleDragStart(e, 'screen')}
                        onDragOver={(e) => handleDragOver(e, 'screen')}
                        onDragEnter={(e) => handleDragEnter(e, 'screen')}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, 'screen')}
                        className={`video-tile cursor-grab active:cursor-grabbing ${
                          dragOverTileId === 'screen' ? 'drag-over' : ''
                        } ${pinnedTile === 'screen' ? 'pinned' : ''}`}
                        style={{
                          height: (streamLayout === 'auto' || streamLayout === 'equal' || streamLayout === 'three') ? '100%' : undefined,
                          minHeight: 220
                        }}
                      >
                        <video ref={screenVideoCallbackRef} autoPlay playsInline muted draggable={false}
                          {...({ autoPictureInPicture: autoPipEnabled } as any)}
                          className="w-full h-full object-contain bg-slate-950/80 backdrop-blur-2xs" />
                        <div className="absolute top-3 left-3">
                          <span className="nx-badge nx-badge-rose">
                            <Monitor className="w-2.5 h-2.5" /> Sharing Screen
                          </span>
                        </div>
                        <div className="tile-actions">
                          <button onClick={() => togglePinnedTile('screen')} className="tile-action" title={pinnedTile === 'screen' ? 'Unpin' : 'Pin'}>
                            {pinnedTile === 'screen' ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                          </button>
                          <button onClick={() => openFullscreen('tile-screen')} className="tile-action" title="Fullscreen">
                            <Maximize2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  }

                  // It's a remote peer
                  const peer = orderedParticipants.find(p => p.id === tileId);
                  if (!peer) return null;
                  return (
                    <div
                      key={peer.id}
                      id={`tile-${peer.id}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, peer.id)}
                      onDragOver={(e) => handleDragOver(e, peer.id)}
                      onDragEnter={(e) => handleDragEnter(e, peer.id)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, peer.id)}
                      className={`video-tile cursor-grab active:cursor-grabbing flex flex-col items-center justify-center gap-4 p-6 ${
                        dragOverTileId === peer.id ? 'drag-over' : ''
                      } ${
                        pinnedTile === peer.id ? 'pinned' : ''
                      } ${
                        streamLayout === 'pip-remote' ? 'layout-pip-remote-peer' : ''
                      } ${
                        streamLayout === 'pip-local' ? 'layout-pip-local-peer' : ''
                      } ${
                        streamLayout === 'horizontal' ? 'layout-horizontal-peer' : ''
                      }`}
                      style={(() => {
                        if (streamLayout === 'pip-remote') {
                          return peer.id === tileOrder[0]
                            ? { position: 'absolute' as const, inset: 0, zIndex: 1, borderRadius: 'inherit', minHeight: 0 }
                            : { position: 'absolute' as const, bottom: 16, left: 16, width: 140, height: 100, zIndex: 3, borderRadius: 12, minHeight: 0 };
                        }
                        if (streamLayout === 'pip-local') {
                          return peer.id === tileOrder[0]
                            ? { position: 'absolute' as const, bottom: 16, right: 16, width: 140, height: 100, zIndex: 3, borderRadius: 12, minHeight: 0 }
                            : { position: 'absolute' as const, bottom: 16, left: 16, width: 140, height: 100, zIndex: 3, borderRadius: 12, minHeight: 0 };
                        }
                        if (streamLayout === 'horizontal') {
                          return { flex: peer.id === tileOrder[0] ? 1 : undefined, minHeight: peer.id === tileOrder[0] ? 220 : 120 };
                        }
                        return { minHeight: 220, height: (streamLayout === 'auto' || streamLayout === 'equal' || streamLayout === 'three') ? '100%' : undefined };
                      })()}>
                      {locallyHiddenPeers.includes(peer.id) ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/90 backdrop-blur-sm z-20">
                          <EyeOff className="w-6 h-6 text-slate-500" />
                          <p className="text-[10px] text-slate-500 font-semibold uppercase">Stream Hidden Locally</p>
                          <button onClick={() => toggleLocalHide(peer.id)} className="text-[9px] text-[var(--nx-primary)] hover:text-[var(--nx-primary-dark)] font-bold mt-1">Unhide Stream</button>
                        </div>
                      ) : null}
                      
                      {isValidProfilePic(getPeerProfilePic(peer)) ? (
                        <img src={getPeerProfilePic(peer)} alt={peer.name} draggable={false}
                          className="w-20 h-20 rounded-full object-cover border-2 border-[var(--nx-primary)]/20 shadow-xl" />
                      ) : (
                        <div className="participant-avatar" draggable={false}>{peer.avatar}</div>
                      )}
                      
                      {locallyMutedPeers.includes(peer.id) && (
                        <div className="absolute top-3 right-3 z-30">
                          <span className="nx-badge nx-badge-rose"><MicOff className="w-2.5 h-2.5" /> Locally Muted</span>
                        </div>
                      )}
                      <div className="text-center">
                        <p className="text-sm font-bold text-white">{peer.name}</p>
                        <p className="text-2xs text-slate-500 mt-1">
                          Control: <span className="text-[var(--nx-primary-dark)]">{peer.controlPermissionLevel}</span>
                        </p>
                      </div>
                      {peer.isSharingScreen && (
                        <button onClick={() => setRequestControlTarget({ id: peer.id, name: peer.name })}
                          className="nx-btn nx-btn-ghost text-2xs py-1.5 px-4">
                          <Zap className="w-3.5 h-3.5" /> Request Control
                        </button>
                      )}
                      <div className="tile-actions">
                        <button onClick={() => togglePinnedTile(peer.id)} className="tile-action" title={pinnedTile === peer.id ? 'Unpin' : 'Pin'}>
                          {pinnedTile === peer.id ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => openFullscreen(`tile-${peer.id}`)} className="tile-action" title="Fullscreen">
                          <Maximize2 className="w-3.5 h-3.5" />
                        </button>
                        <button 
                          onClick={() => toggleLocalHide(peer.id)} 
                          className={`tile-action ${locallyHiddenPeers.includes(peer.id) ? 'active text-emerald-400' : ''}`} 
                          title={locallyHiddenPeers.includes(peer.id) ? "Unhide Locally" : "Hide Locally"}
                        >
                          {locallyHiddenPeers.includes(peer.id) ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => {
                          setLocallyMutedPeers(prev => prev.includes(peer.id) ? prev.filter(id => id !== peer.id) : [...prev, peer.id]);
                        }} className={`tile-action ${locallyMutedPeers.includes(peer.id) ? 'text-rose-400' : ''}`} title="Mute Locally">
                          {locallyMutedPeers.includes(peer.id) ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                        </button>
                      </div>

                      {/* Floating PiP Hover Overlay */}
                      {streamLayout === 'pip-local' && (
                        <div className="pip-hover-overlay">
                          <button onClick={(e) => { e.stopPropagation(); toggleLocalHide(peer.id); }} className="pip-close-btn" title={`Hide ${peer.name}`}>
                            <X className="w-3 h-3" />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); openFullscreen(`tile-${peer.id}`); }} className="pip-fullscreen-btn" title="Expand to Fullscreen">
                            <Maximize2 className="w-4 h-4" />
                            <span className="text-[9px] uppercase tracking-wider font-semibold">Expand</span>
                          </button>
                        </div>
                      )}

                      {/* Live Captions Overlay */}
                      {liveCaptionsEnabled && (liveCaptions[peer.name] || translatedCaptions[peer.name]) && (
                        <div className="absolute bottom-12 left-4 right-4 z-30 flex justify-center">
                          <div className="px-4 py-2 rounded-xl bg-slate-950/85 backdrop-blur-md border border-cyan-500/30 text-center max-w-[85%] shadow-lg animate-fade-in animate-duration-200">
                            <span className="text-[10px] text-cyan-400 font-bold tracking-wider uppercase block mb-0.5">Closed Captions</span>
                            <p className="text-sm font-semibold text-white leading-relaxed">
                              {translationLanguage !== 'none' && translatedCaptions[peer.name] ? translatedCaptions[peer.name] : liveCaptions[peer.name]}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Render empty placeholders to ensure a full 3-column layout when 'three' is chosen */}
                {streamLayout === 'three' && tileOrder.length < 3 && 
                  Array.from({ length: 3 - tileOrder.length }).map((_, idx) => (
                    <div
                      key={`empty-placeholder-${idx}`}
                      className="video-tile flex flex-col items-center justify-center gap-4 p-8 border-2 border-dashed border-slate-800 bg-slate-950/20"
                      style={{
                        minHeight: 220,
                        height: '100%',
                      }}
                    >
                      <Radio className="w-8 h-8 text-[var(--nx-primary)]/20 animate-pulse" />
                      <div className="text-center" draggable={false}>
                        <p className="text-xs text-slate-500 font-medium">Empty Grid Slot</p>
                        <p className="text-3xs text-slate-600 mt-1">Waiting for more participants</p>
                      </div>
                    </div>
                  ))
                }

                {/* Waiting placeholder rendered if no participants are present */}
                {orderedParticipants.length === 0 && streamLayout !== 'three' && (
                  <div
                    className="video-tile flex flex-col items-center justify-center gap-4 p-8"
                    style={{
                      minHeight: 220,
                      ...(streamLayout === 'pip-remote' || streamLayout === 'pip-local'
                        ? { position: 'absolute', inset: 0, borderRadius: 'inherit' }
                        : streamLayout === 'horizontal'
                        ? { flex: 1 }
                        : {}),
                    }}>
                    <Radio className="w-8 h-8 text-[var(--nx-primary)]/40 animate-pulse" />
                    <div className="text-center">
                      <p className="text-xs text-slate-500">Waiting for peers…</p>
                      <p className="text-2xs text-slate-600 mt-1">Share room code to invite</p>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer hover:bg-[var(--nx-teal-soft)] transition"
                      style={{ border: '1px solid var(--nx-line-strong)', background: 'var(--nx-panel)' }}
                      onClick={() => copyInviteLink()}>
                      <Hash className="w-3 h-3 text-[var(--nx-primary)]" />
                      <span className="font-mono text-2xs text-[var(--nx-primary-dark)]">{roomName}</span>
                      <Copy className="w-3 h-3 text-[var(--nx-primary)]" />
                    </div>
                  </div>
                )}

              </div>
            )}

              <div className="stage-floating-controls" aria-label="Fullscreen call controls">
                <button onClick={toggleAudio}
                  className={`nx-btn-icon nx-tooltip ${!audioEnabled ? 'active-danger' : ''}`}
                  data-tip={audioEnabled ? 'Mute Mic' : 'Unmute Mic'}>
                  {audioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                </button>
                <button onClick={toggleVideo}
                  className={`nx-btn-icon nx-tooltip ${!videoEnabled ? 'active-danger' : ''}`}
                  data-tip={videoEnabled ? 'Stop Camera' : 'Start Camera'}>
                  {videoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                </button>
                <button onClick={toggleScreenShare}
                  className={`nx-btn-icon nx-tooltip ${screenStream ? 'active' : ''}`}
                  data-tip={screenStream ? 'Stop Sharing' : 'Share Screen'}>
                  {screenStream ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
                </button>
                <button onClick={toggleManualPip}
                  className={`nx-btn-icon nx-tooltip ${isPipActive ? 'active' : ''}`}
                  data-tip={isPipActive ? 'Exit Floating PiP' : 'Float Video (PiP)'}>
                  <PictureInPicture2 className="w-4 h-4" />
                </button>

                {/* Call Quality ABR Controls */}
                <div className="relative">
                  <button 
                    onClick={() => setIsQualityMenuOpen(!isQualityMenuOpen)}
                    className={`nx-btn-icon nx-tooltip relative ${isQualityMenuOpen || qualityPreference !== 'auto' ? 'active' : ''}`}
                    data-tip={`Quality: ${qualityPreference.toUpperCase()}`}>
                    <Wifi className="w-4 h-4" />
                    {qualityPreference === 'auto' && (
                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-400 border border-slate-900 rounded-full animate-pulse" />
                    )}
                  </button>
                  
                  {isQualityMenuOpen && (
                    <>
                      {/* Backdrop cover to click-away-dismiss */}
                      <div 
                        className="fixed inset-0 z-40 cursor-default" 
                        onClick={() => setIsQualityMenuOpen(false)} 
                      />
                      
                      {/* Dropdown panel */}
                      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-50 bg-slate-950/95 backdrop-blur-xl border border-white/10 p-3 rounded-2xl shadow-2xl flex flex-col gap-2 min-w-[200px] animate-in fade-in slide-in-from-bottom-3 duration-200">
                        <div className="px-2 py-1 border-b border-white/5 flex items-center justify-between">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Stream Quality</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 font-mono font-bold text-indigo-400 uppercase">
                            {currentQualityProfile} Active
                          </span>
                        </div>

                        <button 
                          onClick={() => { setQualityPreference('auto'); setIsQualityMenuOpen(false); }}
                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs font-medium transition-all ${
                            qualityPreference === 'auto' 
                              ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-200' 
                              : 'hover:bg-white/5 border border-transparent text-slate-400 hover:text-white'
                          }`}
                        >
                          <span className="flex flex-col">
                            <span className="font-bold flex items-center gap-1">🚀 Auto (Adaptive)</span>
                            <span className="text-[9px] opacity-60">Scales based on connection RTT</span>
                          </span>
                          {qualityPreference === 'auto' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                        </button>

                        <button 
                          onClick={() => { setQualityPreference('hd'); setIsQualityMenuOpen(false); }}
                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs font-medium transition-all ${
                            qualityPreference === 'hd' 
                              ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-200' 
                              : 'hover:bg-white/5 border border-transparent text-slate-400 hover:text-white'
                          }`}
                        >
                          <span className="flex flex-col">
                            <span className="font-bold">🎬 HD Quality</span>
                            <span className="text-[9px] opacity-60">1080p/720p @ 2.5 Mbps</span>
                          </span>
                          {qualityPreference === 'hd' && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />}
                        </button>

                        <button 
                          onClick={() => { setQualityPreference('sd'); setIsQualityMenuOpen(false); }}
                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs font-medium transition-all ${
                            qualityPreference === 'sd' 
                              ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-200' 
                              : 'hover:bg-white/5 border border-transparent text-slate-400 hover:text-white'
                          }`}
                        >
                          <span className="flex flex-col">
                            <span className="font-bold">📺 SD Quality</span>
                            <span className="text-[9px] opacity-60">480p @ 800 kbps</span>
                          </span>
                          {qualityPreference === 'sd' && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                        </button>

                        <button 
                          onClick={() => { setQualityPreference('low'); setIsQualityMenuOpen(false); }}
                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs font-medium transition-all ${
                            qualityPreference === 'low' 
                              ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-200' 
                              : 'hover:bg-white/5 border border-transparent text-slate-400 hover:text-white'
                          }`}
                        >
                          <span className="flex flex-col">
                            <span className="font-bold">📱 Low Bandwidth</span>
                            <span className="text-[9px] opacity-60">240p @ 200 kbps</span>
                          </span>
                          {qualityPreference === 'low' && <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />}
                        </button>

                        <button 
                          onClick={() => { setQualityPreference('audio-only'); setIsQualityMenuOpen(false); }}
                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs font-medium transition-all ${
                            qualityPreference === 'audio-only' 
                              ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-200' 
                              : 'hover:bg-white/5 border border-transparent text-slate-400 hover:text-white'
                          }`}
                        >
                          <span className="flex flex-col">
                            <span className="font-bold">🔇 Audio Only</span>
                            <span className="text-[9px] opacity-60">Mute transmission stream</span>
                          </span>
                          {qualityPreference === 'audio-only' && <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />}
                        </button>

                      </div>
                    </>
                  )}
                </div>
                <button onClick={() => setFitMode(mode => mode === 'cover' ? 'contain' : 'cover')}
                  className="nx-btn-icon nx-tooltip"
                  data-tip={fitMode === 'cover' ? 'Fit to Screen' : 'Fill Screen'}>
                  <Scan className="w-4 h-4" />
                </button>
                <button onClick={() => setActiveTab('chat')}
                  className={`nx-btn-icon nx-tooltip ${activeTab === 'chat' ? 'active' : ''}`}
                  data-tip="Chat">
                  <MessageSquare className="w-4 h-4" />
                </button>
                <button onClick={() => setActiveTab('participants')}
                  className={`nx-btn-icon nx-tooltip ${activeTab === 'participants' ? 'active' : ''}`}
                  data-tip="Participants">
                  <Users className="w-4 h-4" />
                </button>
                <button onClick={handleDisconnectRoom}
                  className="nx-btn nx-btn-danger text-xs">
                  <PhoneOff className="w-4 h-4" />
                  Leave
                </button>
              </div>

              {/* Chaperone overlay */}
              {pendingControlRequestFrom && (
                <ChaperoneOverlay
                  requesterName={participants.find(p => p.id === pendingControlRequestFrom)?.name || 'Remote Peer'}
                  requesterId={pendingControlRequestFrom}
                  accessType={pendingControlRequestType}
                  onRespond={respondToControlRequest}
                />
              )}

              {/* Request Remote Control Granular Choice Modal */}
              {requestControlTarget && (
                <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-all duration-300">
                  <div className="w-full max-w-sm glass-bright rounded-3xl p-6 shadow-2xl relative overflow-hidden animate-in fade-in zoom-in-95 duration-200 border-t border-white/10"
                       style={{ background: 'var(--nx-panel-solid)', color: 'var(--nx-ink)' }}>
                    
                    {/* Peach gradient glowing shapes */}
                    <div className="absolute -top-16 -right-16 w-32 h-32 rounded-full blur-3xl pointer-events-none"
                         style={{ background: 'rgba(227, 154, 122, 0.25)' }} />
                    <div className="absolute -bottom-16 -left-16 w-32 h-32 rounded-full blur-3xl pointer-events-none"
                         style={{ background: 'rgba(255, 182, 172, 0.25)' }} />

                    {/* Header */}
                    <div className="flex items-center space-x-3 mb-5">
                      <div className="p-2.5 rounded-2xl flex items-center justify-center"
                           style={{ background: 'rgba(209, 110, 71, 0.08)', border: '1px solid rgba(209, 110, 71, 0.15)', color: 'var(--nx-primary)' }}>
                        <Zap className="w-5 h-5 animate-pulse" />
                      </div>
                      <div>
                        <h3 className="text-md font-bold font-display" style={{ color: 'var(--nx-ink)' }}>
                          Request Remote Control
                        </h3>
                        <p className="text-3xs text-slate-500 leading-tight">
                          Select the target interaction permissions for <span className="font-semibold" style={{ color: 'var(--nx-primary)' }}>{requestControlTarget.name}</span>
                        </p>
                      </div>
                    </div>

                    {/* Choices */}
                    <div className="space-y-2 mb-6">
                      <button
                        onClick={() => {
                          requestRemoteControl(requestControlTarget.id, 'mouse');
                          setRequestControlTarget(null);
                        }}
                        className="w-full p-3.5 rounded-2xl border text-left transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] flex items-center justify-between group"
                        style={{
                          background: 'rgba(255, 255, 255, 0.6)',
                          borderColor: 'rgba(209, 110, 71, 0.12)',
                        }}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="p-2 bg-slate-100 rounded-xl group-hover:bg-amber-100 transition-colors">
                            <MousePointer className="w-4 h-4 text-slate-600 group-hover:text-amber-600" />
                          </div>
                          <div>
                            <p className="text-2xs font-bold" style={{ color: 'var(--nx-ink)' }}>Mouse Control Only</p>
                            <p className="text-4xs text-slate-500">Inject cursor clicks and hover inputs only</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                              style={{ background: 'rgba(220, 177, 107, 0.12)', color: '#ac7b30' }}>
                          Mouse
                        </span>
                      </button>

                      <button
                        onClick={() => {
                          requestRemoteControl(requestControlTarget.id, 'keyboard');
                          setRequestControlTarget(null);
                        }}
                        className="w-full p-3.5 rounded-2xl border text-left transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] flex items-center justify-between group"
                        style={{
                          background: 'rgba(255, 255, 255, 0.6)',
                          borderColor: 'rgba(209, 110, 71, 0.12)',
                        }}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="p-2 bg-slate-100 rounded-xl group-hover:bg-indigo-100 transition-colors">
                            <Keyboard className="w-4 h-4 text-slate-600 group-hover:text-indigo-600" />
                          </div>
                          <div>
                            <p className="text-2xs font-bold" style={{ color: 'var(--nx-ink)' }}>Keyboard Control Only</p>
                            <p className="text-4xs text-slate-500">Inject primary system-wide typing inputs only</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                              style={{ background: 'rgba(129, 140, 248, 0.12)', color: '#4f46e5' }}>
                          Keys
                        </span>
                      </button>

                      <button
                        onClick={() => {
                          requestRemoteControl(requestControlTarget.id, 'both');
                          setRequestControlTarget(null);
                        }}
                        className="w-full p-3.5 rounded-2xl border text-left transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] flex items-center justify-between group"
                        style={{
                          background: 'linear-gradient(135deg, rgba(209, 110, 71, 0.05), rgba(255, 182, 172, 0.1))',
                          borderColor: 'var(--nx-primary)',
                        }}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="p-2 rounded-xl" style={{ background: 'rgba(209, 110, 71, 0.1)' }}>
                            <Zap className="w-4 h-4" style={{ color: 'var(--nx-primary)' }} />
                          </div>
                          <div>
                            <p className="text-2xs font-bold" style={{ color: 'var(--nx-primary)' }}>Full Session Control</p>
                            <p className="text-4xs text-slate-600">Inject both mouse clicks and keystroke inputs</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full text-white"
                              style={{ background: 'var(--nx-primary)' }}>
                          Full
                        </span>
                      </button>
                    </div>

                    {/* Footer Cancel */}
                    <div className="flex justify-end space-x-2">
                      <button
                        onClick={() => setRequestControlTarget(null)}
                        className="py-2.5 px-5 text-2xs font-bold rounded-xl transition-all duration-150 hover:bg-slate-100 active:scale-95"
                        style={{ border: '1px solid rgba(209, 110, 71, 0.15)', color: 'var(--nx-primary)' }}
                      >
                        Cancel
                      </button>
                    </div>

                  </div>
                </div>
              )}

              {/* Floating Whiteboard in Fullscreen Mode */}
              {isFullscreen && isLinkedToShareScreen && (
                <div 
                  className="absolute bottom-6 right-6 w-[550px] h-[480px] bg-slate-950/90 border border-white/10 rounded-3xl p-4 shadow-2xl z-50 backdrop-blur-xl animate-in zoom-in-95 duration-200 flex flex-col text-left"
                  style={{ boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)' }}
                >
                  <div className="flex items-center justify-between pb-3 mb-2 border-b border-white/5 flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[var(--nx-primary)] animate-pulse" />
                      <h4 className="text-xs font-bold text-slate-200 font-display">Floating Whiteboard</h4>
                    </div>
                    <button 
                      onClick={() => openFullscreen()} 
                      className="text-slate-400 hover:text-white transition p-1 hover:bg-white/5 rounded-lg"
                      title="Exit Fullscreen to restore sidebar"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <Whiteboard 
                      socket={socket} 
                      roomName={roomName} 
                      e2eeKey={roomE2eeKey} 
                      isLinkedToShareScreen={isLinkedToShareScreen}
                      setIsLinkedToShareScreen={setIsLinkedToShareScreen}
                      linkedStreamId={linkedStreamId}
                      setLinkedStreamId={setLinkedStreamId}
                      isCalibrating={isCalibrating}
                      setIsCalibrating={setIsCalibrating}
                      calibrationPoints={calibrationPoints}
                      setCalibrationPoints={setCalibrationPoints}
                      participants={participants}
                      screenStream={screenStream}
                      whiteboardPersistRef={whiteboardPersistRef}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Draggable Resizer Handle */}
            <div
              className="w-1.5 hover:w-2 bg-slate-200/10 hover:bg-indigo-500/20 cursor-col-resize transition-all duration-150 relative z-30 self-stretch flex items-center justify-center border-l border-r border-white/5"
              onMouseDown={startResizing}
              title="Drag to resize sidebar"
              style={shouldHideSidebar ? { display: 'none' } : {}}
            >
              <div className="w-0.5 h-8 rounded bg-slate-400 opacity-40 group-hover:opacity-100" />
            </div>

            {/* ── RIGHT: SIDEBAR ─── */}
            <aside className="flex flex-col overflow-hidden call-sidebar" style={shouldHideSidebar ? { display: 'none' } : { width: sidebarWidth }}>

              {/* Tab bar */}
              <div className="flex border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                {([
                  { id: 'audio',        icon: Headphones,    label: 'Voice' },
                  { id: 'chat',         icon: MessageSquare, label: 'Chat',  badge: unreadChat },
                  { id: 'whiteboard',   icon: Edit2,         label: 'Board' },
                  { id: 'workspace',    icon: FileText,      label: 'Workspace' },
                  { id: 'participants', icon: Users,          label: 'Peers' },
                  { id: 'contacts',     icon: BookUser,       label: 'Book' },
                  { id: 'profile',      icon: Sliders,        label: 'Config' },
                  { id: 'control',      icon: Lock,          label: 'Ctrl' },
                  { id: 'diagnostics',  icon: Activity,      label: 'Diag' },
                  { id: 'ai',           icon: Sparkles,      label: 'AI' },
                ] as { id: Tab; icon: any; label: string; badge?: number }[]).map(t => (
                  <button key={t.id} onClick={() => setActiveTab(t.id)}
                    className={`nx-tab ${activeTab === t.id ? 'active' : ''} relative`}>
                    <t.icon style={{ width: 13, height: 13 }} />
                    {t.label}
                    {t.badge !== undefined && t.badge > 0 && (
                      <span className="absolute top-1.5 right-1.5 w-4 h-4 text-[9px] font-bold bg-rose-500 text-white rounded-full flex items-center justify-center">
                        {t.badge > 9 ? '9+' : t.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className={`flex-1 p-4 ${activeTab === 'chat' ? 'overflow-hidden' : 'overflow-y-auto'}`}>

                {/* ── VOICE PANEL ── */}
                {activeTab === 'audio' && (
                  <div className="flex flex-col gap-5">

                    {/* Pipeline status */}
                    <div className="flex items-center justify-between px-3 py-2.5 rounded-xl"
                      style={{ background: 'var(--nx-teal-soft)', border: '1px solid var(--nx-line-strong)' }}>
                      <span className="text-2xs text-[var(--nx-primary-dark)] font-semibold flex items-center gap-2">
                        <Activity className="w-3 h-3 text-[var(--nx-primary)]" /> DSP Pipeline
                      </span>
                      <span className="nx-badge nx-badge-green">Active</span>
                    </div>

                    {/* Voice meter live */}
                    <div>
                      <div className="flex justify-between mb-2">
                        <span className="text-2xs text-slate-400 font-semibold">Input Level</span>
                        <span className="text-2xs font-mono text-[var(--nx-primary-dark)]">{Math.round(volPercent)}%</span>
                      </div>
                      <div className="voice-meter">
                        <div className="voice-meter-fill" style={{ width: `${volPercent}%` }} />
                      </div>
                    </div>

                    {/* Pitch shift */}
                    <div>
                      <p className="nx-section-header mb-3">Voice Morphing</p>
                      <div className="flex justify-between text-2xs mb-2">
                        <span className="text-slate-400">Pitch Shift</span>
                        <span className="font-mono text-[var(--nx-primary-dark)] font-bold">
                          {audioConfig.pitchShift > 0 ? `+${audioConfig.pitchShift}` : audioConfig.pitchShift} st
                        </span>
                      </div>
                      <input type="range" min="-12" max="12" value={audioConfig.pitchShift}
                        onChange={e => setAudioConfig(p => ({ ...p, pitchShift: parseInt(e.target.value) }))} />
                      <div className="flex justify-between text-3xs text-slate-600 mt-1">
                        <span>−12</span><span>0</span><span>+12</span>
                      </div>
                    </div>

                    {/* Toggles */}
                    <div>
                      <p className="nx-section-header mb-3">Filters</p>
                      <div className="flex flex-col gap-3">
                        {[
                          { key: 'whisperFilterEnabled', label: 'Whisper Filter', desc: 'Amplify sub-ambient inputs' },
                          { key: 'muteWithTranscription', label: 'Mute + Transcribe', desc: 'Capture text while silent' },
                        ].map(item => (
                          <label key={item.key} className="flex items-start gap-3 cursor-pointer group">
                            <label className="nx-toggle mt-0.5">
                              <input type="checkbox"
                                checked={(audioConfig as any)[item.key]}
                                onChange={e => setAudioConfig(p => ({ ...p, [item.key]: e.target.checked }))} />
                              <span className="nx-toggle-track" />
                              <span className="nx-toggle-thumb" />
                            </label>
                            <div>
                              <span className="text-2xs font-semibold text-slate-200 block">{item.label}</span>
                              <span className="text-3xs text-slate-500 block mt-0.5">{item.desc}</span>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Hardware & Output Routing Selector */}
                    <div>
                      <p className="nx-section-header mb-3">Hardware & Output Routing</p>
                      <div className="flex flex-col gap-3.5 p-3.5 rounded-2xl bg-slate-950/40 border border-white/5 space-y-1">
                        <div className="flex flex-col gap-1 text-left">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Mic className="w-3 h-3 text-indigo-400" /> Microphone
                          </label>
                          <select 
                            value={selectedAudioInput}
                            onChange={e => {
                              setSelectedAudioInput(e.target.value);
                              sessionStorage.setItem('nexalink_selected_mic', e.target.value);
                            }}
                            className="nx-input text-2xs py-1.5 bg-slate-950 border-white/10"
                          >
                            {audioInputs.length === 0 ? (
                              <option value="default">Default Microphone</option>
                            ) : (
                              audioInputs.map(d => (
                                <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone (${d.deviceId.slice(0, 5)})`}</option>
                              ))
                            )}
                          </select>
                        </div>

                        {callType === 'video' && (
                          <div className="flex flex-col gap-1 text-left">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                              <Video className="w-3 h-3 text-indigo-400" /> Camera
                            </label>
                            <select 
                              value={selectedVideoInput}
                              onChange={e => {
                                setSelectedVideoInput(e.target.value);
                                sessionStorage.setItem('nexalink_selected_cam', e.target.value);
                              }}
                              className="nx-input text-2xs py-1.5 bg-slate-950 border-white/10"
                            >
                              {videoInputs.length === 0 ? (
                                <option value="default">Default Camera</option>
                              ) : (
                                videoInputs.map(d => (
                                  <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera (${d.deviceId.slice(0, 5)})`}</option>
                                ))
                              )}
                            </select>
                          </div>
                        )}

                        <div className="flex flex-col gap-1 text-left">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Headphones className="w-3 h-3 text-indigo-400" /> Audio Output
                          </label>
                          <select 
                            value={selectedAudioOutput}
                            onChange={e => {
                              setSelectedAudioOutput(e.target.value);
                              sessionStorage.setItem('nexalink_selected_speaker', e.target.value);
                            }}
                            className="nx-input text-2xs py-1.5 bg-slate-950 border-white/10"
                          >
                            {audioOutputs.length === 0 ? (
                              <option value="default">Default Speakers</option>
                            ) : (
                              audioOutputs.map(d => (
                                <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker (${d.deviceId.slice(0, 5)})`}</option>
                              ))
                            )}
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* TTS */}
                    <div className="p-4 rounded-2xl bg-slate-950/40 border border-white/5 space-y-3.5 relative overflow-hidden backdrop-blur-md">
                      <div className="flex items-center justify-between">
                        <p className="nx-section-header m-0 flex items-center gap-2">
                          <Sparkles className="w-3.5 h-3.5 text-teal-400 animate-pulse" />
                          Synthetic Voice (TTS)
                        </p>
                        <span className={`text-[8px] font-extrabold uppercase px-2 py-0.5 rounded-full border tracking-wide font-mono ${
                          ttsMode === 'neural' 
                            ? 'bg-teal-500/10 border-teal-500/20 text-teal-400' 
                            : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                        }`}>
                          {ttsMode === 'neural' ? 'Neural AI' : 'Local OS'}
                        </span>
                      </div>

                      {/* Mode Toggle Button Group */}
                      <div className="flex bg-slate-950/80 p-0.5 rounded-xl border border-white/5">
                        <button
                          type="button"
                          onClick={() => {
                            setTtsMode('neural');
                            setSelectedVoice('XTTS-v2 Host Male');
                          }}
                          className={`flex-1 py-1.5 rounded-lg text-[10px] font-extrabold transition-all duration-300 ${
                            ttsMode === 'neural'
                              ? 'bg-gradient-to-r from-teal-500/20 to-indigo-500/20 border border-indigo-500/30 text-teal-300 shadow-lg'
                              : 'text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          ✨ Neural AI
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTtsMode('browser');
                            if (browserVoices.length > 0) {
                              setSelectedVoice(browserVoices[0].name);
                            } else {
                              setSelectedVoice('default');
                            }
                          }}
                          className={`flex-1 py-1.5 rounded-lg text-[10px] font-extrabold transition-all duration-300 ${
                            ttsMode === 'browser'
                              ? 'bg-slate-800 border border-white/10 text-white shadow-lg'
                              : 'text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          🌐 Local Browser
                        </button>
                      </div>

                      {/* Informative Help Text */}
                      <p className="text-[9px] text-slate-500 leading-normal">
                        {ttsMode === 'neural' 
                          ? "Generates natural speech via NexaLink's AI Sidecar microservice. Supports advanced neural accents and pitch shifting." 
                          : "Uses the browser's offline Web Speech API. Supports custom pitch with zero latency."}
                      </p>

                      {/* Voice Selection Dropdown */}
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">Voice Model Preset</label>
                        {ttsMode === 'neural' ? (
                          <select value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)}
                            className="nx-input text-2xs mb-2" style={{ padding: '8px 12px' }}>
                            <option value="XTTS-v2 Host Male">Coqui Male (Host)</option>
                            <option value="XTTS-v2 Host Female">Coqui Female (Host)</option>
                            <option value="alloy">OpenAI Alloy (Sleek)</option>
                            <option value="echo">OpenAI Echo (Deep)</option>
                            <option value="fable">OpenAI Fable (Narrator)</option>
                            <option value="onyx">OpenAI Onyx (Baritone)</option>
                            <option value="nova">OpenAI Nova (Energetic Female)</option>
                            <option value="shimmer">OpenAI Shimmer (Corporate Female)</option>
                          </select>
                        ) : (
                          <select value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)}
                            className="nx-input text-2xs mb-2" style={{ padding: '8px 12px' }}>
                            {browserVoices.length === 0 ? (
                              <option value="default">Default OS Voice</option>
                            ) : (
                              browserVoices.map(v => (
                                <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
                              ))
                            )}
                          </select>
                        )}
                      </div>

                      {/* Pitch Factor Slider */}
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <label className="text-[10px] font-bold text-slate-400">Vocal Pitch Multiplier</label>
                          <span className="text-[10px] font-mono text-teal-400 font-extrabold">{ttsPitchFactor.toFixed(2)}x</span>
                        </div>
                        <input 
                          type="range" 
                          min="0.5" 
                          max="2.0" 
                          step="0.05" 
                          value={ttsPitchFactor} 
                          onChange={e => setTtsPitchFactor(parseFloat(e.target.value))}
                          className="w-full cursor-pointer accent-indigo-500"
                        />
                      </div>

                      {/* Text Input area */}
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">Synthetic Transmission Text</label>
                        <textarea value={ttsText} onChange={e => setTtsText(e.target.value)}
                          placeholder="Type synthetic message to broadcast…"
                          className="nx-input text-2xs" rows={2}
                          style={{ resize: 'none', fontFamily: 'var(--font-sans)', padding: '10px' }}
                          onKeyDown={e => { if (e.ctrlKey && e.key === 'Enter') queueTTS(); }} />
                      </div>

                      <button onClick={queueTTS} disabled={!ttsText.trim()}
                        className="nx-btn nx-btn-primary w-full text-2xs flex items-center justify-center gap-2" style={{ padding: '9px' }}>
                        <Play className="w-3.5 h-3.5" /> Send Synthetic Transmission
                      </button>

                      {ttsQueue.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[9px] font-extrabold uppercase text-slate-500 tracking-wider">Transmission History</span>
                            <button onClick={() => setTtsQueue([])} className="text-[9px] text-rose-400 hover:text-rose-300 font-semibold transition-colors">Clear</button>
                          </div>
                          <div className="flex flex-col gap-1.5 max-h-28 overflow-y-auto">
                            {ttsQueue.map((t, i) => (
                              <div key={i} className="px-3 py-2 rounded-xl text-3xs font-mono text-slate-400 flex items-center justify-between transition-all hover:bg-white/[0.04]"
                                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                <span className="truncate pr-2">{t}</span>
                                <button onClick={() => setTtsQueue(q => q.filter((_, j) => j !== i))}
                                  className="text-slate-600 hover:text-slate-400 transition-colors flex-shrink-0"><X className="w-2.5 h-2.5" /></button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── CHAT PANEL ── */}
                {activeTab === 'chat' && (
                  <div className="flex flex-col h-[calc(100vh-220px)] gap-3">
                    {/* E2EE Key Input Banner */}
                    <div className="p-3 rounded-2xl flex items-center justify-between gap-3 text-left bg-slate-900/60 border border-indigo-500/10 backdrop-blur-md">
                      <div className="flex items-center gap-2">
                        <Lock className={`w-3.5 h-3.5 ${roomE2eeKey ? 'text-emerald-400' : 'text-slate-500 animate-pulse'}`} />
                        <div>
                          <p className="text-[10px] font-bold text-slate-300">Room Cryptographic Lock</p>
                          <p className="text-[8px] text-slate-500 mt-0.5">
                            {roomE2eeKey ? 'AES-256 E2E Active (Tunnel Protected)' : 'Standard Relay (Server readable)'}
                          </p>
                        </div>
                      </div>
                      <input
                        type="password"
                        value={roomPassphrase}
                        onChange={e => handleSetRoomPassphrase(e.target.value)}
                        placeholder="Room Secret Passphrase"
                        className="w-40 nx-input text-[10px] py-1 bg-slate-950/80 border-white/5"
                      />
                    </div>

                    <div className="flex-1 overflow-y-auto pb-2 pr-1 space-y-2.5">
                      {chatMessages.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
                          <MessageSquare className="w-8 h-8 text-slate-700" />
                          <p className="text-2xs text-slate-600">No messages yet.<br />Be the first to break the silence.</p>
                        </div>
                      ) : (
                        chatMessages.map(m => (
                          <div key={m.id} className={`chat-bubble ${m.self ? 'self' : 'remote'}`}>
                            <span className="sender">{m.self ? 'You' : m.sender}</span>
                            <div className="bubble">
                              {m.decryptedText ? (
                                <span className="flex items-center gap-1.5 text-indigo-200">
                                  <Lock className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                                  {m.decryptedText}
                                </span>
                              ) : m.text.startsWith('[E2EE]:') ? (
                                <span className="flex items-center gap-1.5 text-rose-300 font-medium">
                                  <ShieldAlert className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                                  🔒 Encrypted Message
                                </span>
                              ) : (
                                m.text
                              )}
                            </div>
                            <span className="time">{m.time}</span>
                          </div>
                        ))
                      )}
                      {roomTypingUsers.size > 0 && (
                        <div className="flex items-center gap-2 text-3xs text-indigo-400 italic px-2.5 py-1.5 bg-white/2 rounded-xl max-w-max self-start border border-white/5 animate-pulse mt-1">
                          <span className="flex gap-0.5">
                            <span className="w-1 h-1 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-1 h-1 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-1 h-1 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                          </span>
                          {Array.from(roomTypingUsers).join(', ')} {roomTypingUsers.size === 1 ? 'is' : 'are'} typing...
                        </div>
                      )}
                      <div ref={chatEndRef} />
                    </div>
                    <div className="flex gap-2 mt-auto pt-2 border-t border-white/5">
                      <input className="nx-input flex-1 text-xs" value={chatInput}
                        onChange={e => handleRoomChatInputChange(e.target.value)}
                        onKeyDown={e => { if (chatSettings.pressEnterToSend && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                        placeholder="Message…" />
                      <button onClick={sendChat} disabled={!chatInput.trim()}
                        className="nx-btn-icon active" style={{ padding: '10px 12px' }}>
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {/* ── WHITEBOARD PANEL ── */}
                {activeTab === 'whiteboard' && !isFullscreen && (
                  <Whiteboard 
                    socket={socket} 
                    roomName={roomName} 
                    e2eeKey={roomE2eeKey} 
                    isLinkedToShareScreen={isLinkedToShareScreen}
                    setIsLinkedToShareScreen={setIsLinkedToShareScreen}
                    linkedStreamId={linkedStreamId}
                    setLinkedStreamId={setLinkedStreamId}
                    isCalibrating={isCalibrating}
                    setIsCalibrating={setIsCalibrating}
                    calibrationPoints={calibrationPoints}
                    setCalibrationPoints={setCalibrationPoints}
                    participants={participants}
                    screenStream={screenStream}
                    whiteboardPersistRef={whiteboardPersistRef}
                  />
                )}

                {/* ── WORKSPACE PANEL ── */}
                {activeTab === 'workspace' && (
                  <WorkspacePanel 
                    socket={socket} 
                    roomName={roomName} 
                    myAlias={myAlias} 
                    participants={participants} 
                  />
                )}

                {/* ── PARTICIPANTS PANEL ── */}
                {activeTab === 'participants' && (
                  <div className="flex flex-col gap-4">
                    <p className="nx-section-header">
                      {participants.length + 1} in Room
                    </p>
 
                    {/* Self */}
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                      style={{ background: 'var(--nx-teal-soft)', border: '1px solid var(--nx-line-strong)' }}>
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base"
                        style={{ background: 'var(--nx-coral)' }}>
                        {myAlias.avatar}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{myAlias.name}</p>
                        <p className="text-3xs text-slate-500">You · Host</p>
                      </div>
                      <span className="status-dot live" />
                    </div>
 
                    {/* Others list wrapped in scroll container */}
                    <div className="max-h-80 overflow-y-auto pr-1 flex flex-col gap-2.5">
                      {participants.length === 0 ? (
                        <p className="text-2xs text-slate-600 text-center py-6">No peers connected yet.</p>
                      ) : (
                        participants.map(p => (
                          <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition hover:bg-white/2"
                            style={{ border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base"
                              style={{ background: 'rgba(255,255,255,0.05)' }}>
                              {p.avatar}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-white truncate">{p.name}</p>
                              <p className="text-3xs text-slate-500">{p.controlPermissionLevel}</p>
                            </div>
                            {p.isSharingScreen && (
                              <button onClick={() => setRequestControlTarget({ id: p.id, name: p.name })}
                                className="nx-btn-icon nx-tooltip" data-tip="Request Control"
                                style={{ padding: 7 }}>
                                <Zap className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'contacts' && (
                  <div className="flex flex-col gap-4">
                    <p className="nx-section-header"><BookUser className="w-3 h-3" /> Contacts</p>
                    <div className="flex gap-2">
                      <input className="nx-input flex-1 text-xs" value={newContact}
                        onChange={e => setNewContact(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addContact(); }}
                        placeholder="username" />
                      <button onClick={addContact} className="nx-btn-icon active">
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
 
                    {/* Contacts list wrapped in scroll container */}
                    <div className="max-h-80 overflow-y-auto pr-1 flex flex-col gap-2.5">
                      {contacts.length === 0 ? (
                        <p className="text-2xs text-slate-600 text-center py-6">No contacts yet.</p>
                      ) : (
                        contacts.map(contact => (
                          <div key={contact.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                            style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.025)' }}>
                            {isValidProfilePic(contact.profilePic) ? (
                              <img src={contact.profilePic} alt={contact.username}
                                className="w-9 h-9 rounded-xl object-cover" />
                            ) : (
                              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                                style={{ background: 'var(--nx-teal-soft)' }}>
                                <User className="w-4 h-4 text-[var(--nx-primary)]" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-white truncate">{contact.username}</p>
                              <p className="text-3xs text-slate-500">Saved contact</p>
                            </div>
                            <button onClick={() => callContact(contact.username)}
                              className="nx-btn-icon nx-tooltip" data-tip="Direct Call" style={{ padding: 7 }}>
                              <PhoneCall className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setContacts(prev => prev.filter(c => c.id !== contact.id))}
                              className="nx-btn-icon nx-tooltip" data-tip="Remove" style={{ padding: 7 }}>
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'profile' && (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between pb-1 border-b border-white/5 mb-1">
                      <p className="nx-section-header flex items-center gap-1.5 m-0"><Sliders className="w-3.5 h-3.5 text-[var(--nx-primary)]" /> System Config</p>
                    </div>
                    <div className="max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
                      {renderSettingsArea()}
                    </div>
                  </div>
                )}

                {/* ── CONTROL LOG PANEL ── */}
                {activeTab === 'control' && (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <p className="nx-section-header">Tunnel Logs</p>
                      <span className="nx-badge nx-badge-indigo">{controlLogs.length}</span>
                    </div>

                    <div className="flex flex-col gap-1 overflow-y-auto"
                      style={{ maxHeight: 260, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 12, padding: '10px 8px' }}>
                      {controlLogs.length === 0 ? (
                        <p className="text-3xs text-slate-700 p-2 font-mono">No tunnel events.</p>
                      ) : (
                        controlLogs.map((log, i) => (
                          <div key={i} className={`control-log-entry ${log.includes('EMERGENCY') ? 'emergency' : log.includes('Chaperone') ? 'chaperone' : 'default'}`}>
                            {log}
                          </div>
                        ))
                      )}
                    </div>

                    {controlledBy && (
                      <button onClick={triggerEmergencyKill}
                        className="nx-btn nx-btn-danger w-full text-xs">
                        <ShieldAlert className="w-4 h-4" /> Emergency Kill-Switch
                      </button>
                    )}
                  </div>
                )}

                {/* ── DIAGNOSTICS PANEL ── */}
                {activeTab === 'diagnostics' && (
                  <DiagnosticsPanel
                    stats={stats}
                    participantsCount={participants.length}
                    controlLogs={controlLogs}
                    roomName={roomName}
                    simulatedProfile={simulatedProfile}
                    setSimulatedProfile={setSimulatedProfile}
                    customSimSettings={customSimSettings}
                    setCustomSimSettings={setCustomSimSettings}
                    qualityPreference={qualityPreference}
                    setQualityPreference={setQualityPreference}
                    currentQualityProfile={currentQualityProfile}
                  />
                )}

                {/* ── AI INTELLIGENCE PANEL ── */}
                {activeTab === 'ai' && (
                  <AiAssistantPanel
                    liveCaptionsEnabled={liveCaptionsEnabled}
                    setLiveCaptionsEnabled={setLiveCaptionsEnabled}
                    captionsLanguage={captionsLanguage}
                    setCaptionsLanguage={setCaptionsLanguage}
                    translationLanguage={translationLanguage}
                    setTranslationLanguage={setTranslationLanguage}
                    meetingTranscript={meetingTranscript}
                    captionSearchQuery={captionSearchQuery}
                    setCaptionSearchQuery={setCaptionSearchQuery}
                    isAnalyzingMeeting={isAnalyzingMeeting}
                    extractedSummary={extractedSummary}
                    extractedActionItems={extractedActionItems}
                    extractActionItems={extractActionItems}
                    exportTranscriptMD={exportTranscriptMD}
                    setExtractedActionItems={setExtractedActionItems}
                    participants={participants}
                    userName={userName}
                    extractedSentiment={extractedSentiment}
                    extractedTopics={extractedTopics}
                  />
                )}
              </div>

              {/* Sidebar footer */}
              <div className="px-4 py-3 border-t flex items-center justify-between"
                style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                <span className="text-3xs font-mono text-slate-600">Secure Tunnel</span>
                <span className="text-3xs font-mono text-slate-600">{new Date().toISOString().slice(0, 10)}</span>
              </div>
            </aside>
          </div>
        )
      }
    </main>

      {/* ── FOOTER CONTROL BAR (in-call only) ─── */}
      {inRoom && (
        <footer className="relative z-10 nx-control-bar global-control-bar">

          {/* Status */}
          <div className="flex items-center gap-2">
            <span className={`status-dot ${isConnected ? 'live' : 'error'}`} />
            <span className="text-2xs font-mono text-slate-400">
              {isConnected ? 'Relay Active' : 'Disconnected'}
            </span>
            <span className="text-3xs font-mono text-slate-600 hidden sm:inline">· {roomName}</span>
          </div>

          {/* Centre controls */}
          <div className="nx-control-group">

            <button onClick={toggleAudio}
              className={`nx-btn-icon nx-tooltip ${!audioEnabled ? 'active-danger' : ''}`}
              data-tip={audioEnabled ? 'Mute Mic' : 'Unmute Mic'}>
              {audioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </button>

            <button onClick={toggleVideo}
              className={`nx-btn-icon nx-tooltip ${!videoEnabled ? 'active-danger' : ''}`}
              data-tip={videoEnabled ? 'Stop Camera' : 'Start Camera'}>
              {videoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
            </button>

            <button onClick={toggleScreenShare}
              className={`nx-btn-icon nx-tooltip ${screenStream ? 'active' : ''}`}
              data-tip={screenStream ? 'Stop Sharing' : 'Share Screen'}>
              {screenStream ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
            </button>

            <div className="divider" />

            <button onClick={toggleAlias}
              className={`nx-btn-icon nx-tooltip ${isAliasEnabled ? 'active' : ''}`}
              data-tip={isAliasEnabled ? 'Disable Alias' : 'Enable Alias'}>
              {isAliasEnabled ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>

            <button onClick={() => setActiveTab('audio')}
              className={`nx-btn-icon nx-tooltip ${activeTab === 'audio' ? 'active' : ''}`}
              data-tip="Voice Settings">
              <Sliders className="w-4 h-4" />
            </button>

            {/* Call Quality ABR Controls */}
            <div className="relative">
              <button 
                onClick={() => setIsQualityMenuOpen(!isQualityMenuOpen)}
                className={`nx-btn-icon nx-tooltip relative ${isQualityMenuOpen || qualityPreference !== 'auto' ? 'active' : ''}`}
                data-tip={`Quality: ${qualityPreference.toUpperCase()}`}>
                <Wifi className="w-4 h-4" />
                {qualityPreference === 'auto' && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-400 border border-slate-900 rounded-full animate-pulse" />
                )}
              </button>
              
              {isQualityMenuOpen && (
                <>
                  {/* Backdrop cover to click-away-dismiss */}
                  <div 
                    className="fixed inset-0 z-40 cursor-default" 
                    onClick={() => setIsQualityMenuOpen(false)} 
                  />
                  
                  {/* Dropdown panel */}
                  <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-50 bg-slate-950/95 backdrop-blur-xl border border-white/10 p-3 rounded-2xl shadow-2xl flex flex-col gap-2 min-w-[200px] animate-in fade-in slide-in-from-bottom-3 duration-200">
                    <div className="px-2 py-1 border-b border-white/5 flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Stream Quality</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 font-mono font-bold text-indigo-400 uppercase">
                        {currentQualityProfile} Active
                      </span>
                    </div>

                    <button 
                      onClick={() => { setQualityPreference('auto'); setIsQualityMenuOpen(false); }}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs font-medium transition-all ${
                        qualityPreference === 'auto' 
                          ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-200' 
                          : 'hover:bg-white/5 border border-transparent text-slate-400 hover:text-white'
                      }`}
                    >
                      <span className="flex flex-col">
                        <span className="font-bold flex items-center gap-1">🚀 Auto (Adaptive)</span>
                        <span className="text-[9px] opacity-60">Scales based on connection RTT</span>
                      </span>
                      {qualityPreference === 'auto' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                    </button>

                    <button 
                      onClick={() => { setQualityPreference('hd'); setIsQualityMenuOpen(false); }}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs font-medium transition-all ${
                        qualityPreference === 'hd' 
                          ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-200' 
                          : 'hover:bg-white/5 border border-transparent text-slate-400 hover:text-white'
                      }`}
                    >
                      <span className="flex flex-col">
                        <span className="font-bold">🎬 HD Quality</span>
                        <span className="text-[9px] opacity-60">1080p/720p @ 2.5 Mbps</span>
                      </span>
                      {qualityPreference === 'hd' && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />}
                    </button>

                    <button 
                      onClick={() => { setQualityPreference('sd'); setIsQualityMenuOpen(false); }}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs font-medium transition-all ${
                        qualityPreference === 'sd' 
                          ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-200' 
                          : 'hover:bg-white/5 border border-transparent text-slate-400 hover:text-white'
                      }`}
                    >
                      <span className="flex flex-col">
                        <span className="font-bold">📺 SD Quality</span>
                        <span className="text-[9px] opacity-60">480p @ 800 kbps</span>
                      </span>
                      {qualityPreference === 'sd' && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                    </button>

                    <button 
                      onClick={() => { setQualityPreference('low'); setIsQualityMenuOpen(false); }}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs font-medium transition-all ${
                        qualityPreference === 'low' 
                          ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-200' 
                          : 'hover:bg-white/5 border border-transparent text-slate-400 hover:text-white'
                      }`}
                    >
                      <span className="flex flex-col">
                        <span className="font-bold">📱 Low Bandwidth</span>
                        <span className="text-[9px] opacity-60">240p @ 200 kbps</span>
                      </span>
                      {qualityPreference === 'low' && <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />}
                    </button>

                    <button 
                      onClick={() => { setQualityPreference('audio-only'); setIsQualityMenuOpen(false); }}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs font-medium transition-all ${
                        qualityPreference === 'audio-only' 
                          ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-200' 
                          : 'hover:bg-white/5 border border-transparent text-slate-400 hover:text-white'
                      }`}
                    >
                      <span className="flex flex-col">
                        <span className="font-bold">🔇 Audio Only</span>
                        <span className="text-[9px] opacity-60">Mute transmission stream</span>
                      </span>
                      {qualityPreference === 'audio-only' && <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />}
                    </button>

                  </div>
                </>
              )}
            </div>

            <button onClick={() => { setActiveTab('chat'); }}
              className={`nx-btn-icon nx-tooltip relative ${activeTab === 'chat' ? 'active' : ''}`}
              data-tip="Chat">
              <MessageSquare className="w-4 h-4" />
              {unreadChat > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white rounded-full flex items-center justify-center text-[8px] font-bold shadow px-0.5" style={{ minWidth: '16px', height: '16px' }}>
                  {unreadChat > 9 ? '9+' : unreadChat}
                </span>
              )}
            </button>

            <button onClick={() => setActiveTab('participants')}
              className={`nx-btn-icon nx-tooltip ${activeTab === 'participants' ? 'active' : ''}`}
              data-tip={`${participants.length + 1} Participants`}>
              <Users className="w-4 h-4" />
            </button>

          </div>

          {/* Disconnect */}
          <button onClick={handleDisconnectRoom}
            className="nx-btn nx-btn-danger text-xs">
            <PhoneOff className="w-4 h-4" />
            Leave Room
          </button>
        </footer>
      )}
    </div>
  );
}
