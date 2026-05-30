import { useState, useRef, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const WS_URL = (import.meta as any).env?.VITE_WS_URL || 'http://localhost:8000';

export interface Participant {
  id: string;
  name: string;
  avatar: string;
  profilePic?: string;
  bio?: string;
  isMuted: boolean;
  isVideoOff: boolean;
  isSharingScreen: boolean;
  isRemoteControlled: boolean;
  controlPermissionLevel: 'none' | 'view' | 'interact' | 'full';
}

export interface ConnectionStats {
  videoLatency: number;
  audioLatency: number;
  packetLoss: number;
  jitter: number;
  bytesSent?: number;
  bytesReceived?: number;
  bitrateSent?: number;
  bitrateReceived?: number;
  videoFps?: number;
  audioCodec?: string;
  videoCodec?: string;
  localCandidateType?: string;
  remoteCandidateType?: string;
  transportType?: string;
}

export interface UserPresenceProfile {
  profilePic?: string;
  bio?: string;
}

type AliasProfile = {
  name: string;
  avatar: string;
  profilePic: string;
  bio: string;
};

export type SimulatedNetworkProfile = 'auto-drift' | 'fiber' | 'lte' | 'satellite' | 'custom';

export interface CustomSimSettings {
  latency: number;
  packetLoss: number;
  jitter: number;
}


export function useWebRTC(
  roomName: string,
  defaultName: string,
  profile: UserPresenceProfile = {},
  selectedAudioDeviceId?: string,
  selectedVideoDeviceId?: string,
  iceServers?: RTCIceServer[]
) {
  const [isConnected, setIsConnected] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [myAlias, setMyAlias] = useState<AliasProfile>({ name: defaultName, avatar: '👤', profilePic: profile.profilePic || '', bio: profile.bio || '' });
  const [isAliasEnabled, setIsAliasEnabled] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);


  // Remote Control (Phase 4)
  const [controlledBy, setControlledBy] = useState<string | null>(null);
  const [isRemoteControlRequested, setIsRemoteControlRequested] = useState(false);
  const [pendingControlRequestFrom, setPendingControlRequestFrom] = useState<string | null>(null);
  const [pendingControlRequestType, setPendingControlRequestType] = useState<'mouse' | 'keyboard' | 'both'>('both');
  const [controlLogs, setControlLogs] = useState<string[]>([]);

  // Remote Control — active session tracking
  // isControllingTarget: true when THIS client is injecting inputs into a remote host
  // grantedControlTargetId: socket ID of the host we're controlling
  // grantedAccessType: what was approved ('mouse' | 'keyboard' | 'both')
  // remoteControlledBy: for the HOST — the socket ID currently controlling us
  // isHostOverrideActive: true for a brief moment after host reclaims control (UI feedback)
  const [isControllingTarget, setIsControllingTarget] = useState(false);
  const [grantedControlTargetId, setGrantedControlTargetId] = useState<string | null>(null);
  const [grantedAccessType, setGrantedAccessType] = useState<'mouse' | 'keyboard' | 'both'>('both');
  const [remoteControlledBy, setRemoteControlledBy] = useState<string | null>(null);
  const [isHostOverrideActive, setIsHostOverrideActive] = useState(false);

  // Refs for capture/inject cleanup — stored outside React state to avoid re-render overhead
  const captureListenersRef = useRef<{ type: string; fn: EventListener }[]>([]);
  const overrideListenersRef = useRef<{ type: string; fn: EventListener }[]>([]);
  const controlledByRef = useRef<string | null>(null);          // host's ref to requester
  const grantedTargetRef = useRef<string | null>(null);         // requester's ref to host
  const grantedAccessTypeRef = useRef<'mouse' | 'keyboard' | 'both'>('both');

  // BUG FIX #1 & #3: Use a single socketRef (no duplicate useState socket).
  // Use a myAliasRef to always read the latest alias from inside the persistent
  // socket effect without adding myAlias to the dependency array.
  const socketRef = useRef<Socket | null>(null);
  const myAliasRef = useRef(myAlias);
  const peerConnectionsRef = useRef<{ [key: string]: RTCPeerConnection }>({});

  const [qualityPreference, setQualityPreference] = useState<'auto' | 'hd' | 'sd' | 'low' | 'audio-only'>('auto');
  const [currentQualityProfile, setCurrentQualityProfile] = useState<'hd' | 'sd' | 'low' | 'audio-only'>('hd');

  const [simulatedProfile, setSimulatedProfile] = useState<SimulatedNetworkProfile>('auto-drift');
  const [customSimSettings, setCustomSimSettings] = useState<CustomSimSettings>({
    latency: 50,
    packetLoss: 0,
    jitter: 3,
  });

  const simulatedProfileRef = useRef<SimulatedNetworkProfile>('auto-drift');
  const customSimSettingsRef = useRef<CustomSimSettings>({
    latency: 50,
    packetLoss: 0,
    jitter: 3,
  });

  useEffect(() => {
    simulatedProfileRef.current = simulatedProfile;
  }, [simulatedProfile]);

  useEffect(() => {
    customSimSettingsRef.current = customSimSettings;
  }, [customSimSettings]);


  const consecutiveDegradationRef = useRef<number>(0);
  const consecutiveRecoveryRef = useRef<number>(0);
  const lastProfileRef = useRef<'hd' | 'sd' | 'low' | 'audio-only'>('hd');

  // Helper to dynamically apply video quality settings (bitrate limit & resolution scale)
  const applyQualitySettings = useCallback(async (profile: 'hd' | 'sd' | 'low' | 'audio-only') => {
    console.log(`[ABR] Applying video quality profile: ${profile}`);
    
    // 1. Update local video track if present in localStream
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        if (profile === 'audio-only') {
          if (videoTrack.enabled) {
            videoTrack.enabled = false;
            console.log('[ABR] Local video track disabled for bandwidth conservation.');
          }
        } else {
          if (!videoTrack.enabled && videoEnabled) {
            videoTrack.enabled = true;
            console.log('[ABR] Local video track re-enabled.');
          }
        }
      }
    }

    // 2. Scale encodings for all remote peers
    const pcs = Object.values(peerConnectionsRef.current);
    for (const pc of pcs) {
      try {
        const senders = pc.getSenders();
        const videoSender = senders.find(s => s.track?.kind === 'video');
        if (!videoSender) continue;

        const params = videoSender.getParameters();
        if (!params.encodings) {
          params.encodings = [{}];
        }

        if (profile === 'audio-only') {
          params.encodings[0].maxBitrate = 30000; // 30 kbps minimal
          params.encodings[0].scaleResolutionDownBy = 4.0;
        } else if (profile === 'low') {
          params.encodings[0].maxBitrate = 200000; // 200 kbps
          params.encodings[0].scaleResolutionDownBy = 4.0; // scale 720p -> 180p
        } else if (profile === 'sd') {
          params.encodings[0].maxBitrate = 750000; // 750 kbps
          params.encodings[0].scaleResolutionDownBy = 2.0; // scale 720p -> 360p
        } else {
          params.encodings[0].maxBitrate = 2500000; // 2.5 Mbps
          params.encodings[0].scaleResolutionDownBy = 1.0; // full quality
        }

        await videoSender.setParameters(params);
        console.log(`[ABR] Successfully updated RTCRtpSender parameters for peer connection.`);
      } catch (err) {
        console.error('[ABR] Failed to apply RTCRtpSender settings:', err);
      }
    }
  }, [localStream, videoEnabled]);

  // Synchronize manual quality preference overrides
  useEffect(() => {
    if (qualityPreference !== 'auto') {
      setCurrentQualityProfile(qualityPreference);
      lastProfileRef.current = qualityPreference;
      consecutiveDegradationRef.current = 0;
      consecutiveRecoveryRef.current = 0;
      
      const logMessage = `[ABR] 👤 Manual override applied: ${
        qualityPreference === 'audio-only' ? 'Audio Only' : qualityPreference === 'low' ? 'Low Bandwidth (240p)' : qualityPreference === 'sd' ? 'Standard Definition (480p)' : 'High Definition (720p)'
      }.`;
      setControlLogs(prev => [...prev, logMessage]);
      applyQualitySettings(qualityPreference);
    } else {
      // Re-evaluating auto logic instantly
      const current = lastProfileRef.current;
      applyQualitySettings(current);
    }
  }, [qualityPreference, applyQualitySettings]);

  const [stats, setStats] = useState<ConnectionStats>({
    videoLatency: 45,
    audioLatency: 22,
    packetLoss: 0,
    jitter: 4,
    bytesSent: 0,
    bytesReceived: 0,
    bitrateSent: 0,
    bitrateReceived: 0,
    videoFps: 30,
    audioCodec: 'opus',
    videoCodec: 'VP8',
    localCandidateType: 'host/prflx',
    remoteCandidateType: 'srflx/relay',
    transportType: 'dtls-srtp',
  });

  // Keep the alias ref in sync with state (no extra render cost)
  useEffect(() => {
    myAliasRef.current = myAlias;
  }, [myAlias]);

  useEffect(() => {
    setMyAlias(prev => {
      const next = { ...prev, profilePic: profile.profilePic || '', bio: profile.bio || '' };
      if (socketRef.current?.connected) {
        socketRef.current.emit('update_alias', { userAlias: next });
      }
      return next;
    });
  }, [profile.profilePic, profile.bio]);

  useEffect(() => {
    if (isAliasEnabled) return;
    setMyAlias(prev => {
      const next = { ...prev, name: defaultName, profilePic: profile.profilePic || '', bio: profile.bio || '' };
      if (socketRef.current?.connected) {
        socketRef.current.emit('update_alias', { userAlias: next });
      }
      return next;
    });
  }, [defaultName, isAliasEnabled, profile.profilePic, profile.bio]);

  // Synchronize local screen sharing status with signaling server in real time
  useEffect(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('toggle_screenshare', { isSharing: !!screenStream });
    }
  }, [screenStream]);

  // BUG FIX #4: Emit update_alias over the existing socket instead of
  // causing a reconnect. Toggling alias never touches the dep array now.
  const toggleAlias = useCallback(() => {
    setIsAliasEnabled(prev => {
      const next = !prev;
      let newAlias: AliasProfile;
      if (next) {
        const randId = Math.floor(1000 + Math.random() * 9000);
        newAlias = {
          name: `GhostParticipant_${randId}`,
          avatar: ['🦊', '🦉', '🐱', '🐼', '🐸', '🐨'][Math.floor(Math.random() * 6)],
          profilePic: profile.profilePic || '',
          bio: profile.bio || '',
        };
      } else {
        newAlias = { name: defaultName, avatar: '👤', profilePic: profile.profilePic || '', bio: profile.bio || '' };
      }
      setMyAlias(newAlias);
      // Emit alias update over existing live socket — no reconnect needed
      if (socketRef.current?.connected) {
        socketRef.current.emit('update_alias', { userAlias: newAlias });
      }
      return next;
    });
  }, [defaultName, profile.profilePic, profile.bio]);

  const syncMediaState = (stream: MediaStream | null) => {
    setAudioEnabled(stream?.getAudioTracks()[0]?.enabled ?? false);
    setVideoEnabled(stream?.getVideoTracks()[0]?.enabled ?? false);
  };

  const initMedia = async (callType: 'voice' | 'video' = 'video') => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
      setAudioEnabled(false);
      setVideoEnabled(false);
      return null;
    }
    try {
      const constraints = {
        video: callType === 'video' ? (selectedVideoDeviceId && selectedVideoDeviceId !== 'default' ? { deviceId: { exact: selectedVideoDeviceId } } : true) : false,
        audio: selectedAudioDeviceId && selectedAudioDeviceId !== 'default' ? { deviceId: { exact: selectedAudioDeviceId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setLocalStream(stream);
      syncMediaState(stream);
      return stream;
    } catch (err) {
      console.error('Failed to get user media devices:', err);
      if (callType === 'voice') {
          // If only voice was requested but failed, we cannot provide a canvas fallback for audio
          return null;
      }
      // Mock stream for testing in non-camera environments
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#1e1b4b';
        ctx.fillRect(0, 0, 640, 480);
      }
      const stream = (canvas as HTMLCanvasElement).captureStream(30);
      setLocalStream(stream);
      syncMediaState(stream);
      return stream;
    }
  };

  // BUG FIX #5: Do NOT recreate the MediaStream object on toggle — this breaks
  // the AudioContext source binding in useAudioPipeline. Simply toggle .enabled.
  const toggleVideo = async () => {
    if (!localStream) {
      await initMedia('video');
      return;
    }
    const stream = localStream;
    let track = stream.getVideoTracks()[0];

    // Hardware issue: If the track is completely stopped and released by the browser to turn the camera off
    // we need a new track. However, replacing tracks breaks DSP, but DSP is audio!
    // It's perfectly safe to fetch a new video track and replace it.
    if (!track || track.readyState === 'ended') {
       try {
           const newStream = await navigator.mediaDevices.getUserMedia({
             video: selectedVideoDeviceId && selectedVideoDeviceId !== 'default' ? { deviceId: { exact: selectedVideoDeviceId } } : true
           });
           const newTrack = newStream.getVideoTracks()[0];
           stream.addTrack(newTrack);

           // Replace the track in all active RTCPeerConnections
           Object.values(peerConnectionsRef.current).forEach(pc => {
             const sender = pc.getSenders().find(s => s.track?.kind === 'video');
             if (sender) {
               sender.replaceTrack(newTrack);
             }
           });

           setVideoEnabled(true);
       } catch (err) {
           console.error('Failed to get video track', err);
       }
       return;
    }

    if (track.enabled) {
      // Hardware issue: user wants camera physically off (light off)
      track.stop();
      stream.removeTrack(track);

      // We must explicitly replace the track in senders with null to stop transmission properly
      Object.values(peerConnectionsRef.current).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
           sender.replaceTrack(null);
        }
      });

      setVideoEnabled(false);
    } else {
      track.enabled = true;
      setVideoEnabled(true);
    }
  };

  const toggleAudio = async () => {
    if (!localStream) {
      await initMedia('voice');
      return;
    }
    const stream = localStream;
    const track = stream.getAudioTracks()[0];
    if (track) {
      // We only toggle .enabled for audio to avoid breaking DSP Context bindings
      track.enabled = !track.enabled;
      setAudioEnabled(track.enabled);
    }
  };

  const toggleScreenShare = async () => {
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      setScreenStream(null);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        setScreenStream(stream);
        stream.getVideoTracks()[0].onended = () => {
          setScreenStream(null);
        };
      } catch (err) {
        console.error('Display capture failed:', err);
      }
    }
  };

  // ── INPUT CAPTURE (Requester side) ─────────────────────────────────────────
  // Attach document-level listeners that intercept the requester's physical
  // mouse/keyboard events and relay them to the host over the socket.
  const startInputCapture = useCallback((targetId: string, accessType: 'mouse' | 'keyboard' | 'both') => {
    stopInputCapture(); // ensure no duplicate listeners

    grantedTargetRef.current = targetId;
    grantedAccessTypeRef.current = accessType;

    const emit = (inputType: string, payload: Record<string, unknown>) => {
      socketRef.current?.emit('remote_input', {
        targetId,
        inputType,
        payload,
        accessType,
      });
    };

    const listeners: { type: string; fn: EventListener }[] = [];

    if (accessType === 'mouse' || accessType === 'both') {
      const onMouseMove = (e: Event) => {
        const me = e as MouseEvent;
        emit('mousemove', {
          x: me.clientX, y: me.clientY,
          screenX: me.screenX, screenY: me.screenY,
          movementX: me.movementX, movementY: me.movementY,
        });
      };
      const onMouseDown = (e: Event) => {
        const me = e as MouseEvent;
        emit('mousedown', { x: me.clientX, y: me.clientY, button: me.button });
      };
      const onMouseUp = (e: Event) => {
        const me = e as MouseEvent;
        emit('mouseup', { x: me.clientX, y: me.clientY, button: me.button });
      };
      const onClick = (e: Event) => {
        const me = e as MouseEvent;
        emit('click', { x: me.clientX, y: me.clientY, button: me.button });
      };
      document.addEventListener('mousemove', onMouseMove, { passive: true });
      document.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mouseup', onMouseUp);
      document.addEventListener('click', onClick);
      listeners.push(
        { type: 'mousemove', fn: onMouseMove as EventListener },
        { type: 'mousedown', fn: onMouseDown as EventListener },
        { type: 'mouseup',   fn: onMouseUp   as EventListener },
        { type: 'click',     fn: onClick      as EventListener },
      );
    }

    if (accessType === 'keyboard' || accessType === 'both') {
      const onKeyDown = (e: Event) => {
        const ke = e as KeyboardEvent;
        emit('keydown', { key: ke.key, code: ke.code, ctrlKey: ke.ctrlKey, shiftKey: ke.shiftKey, altKey: ke.altKey });
      };
      const onKeyUp = (e: Event) => {
        const ke = e as KeyboardEvent;
        emit('keyup', { key: ke.key, code: ke.code, ctrlKey: ke.ctrlKey, shiftKey: ke.shiftKey, altKey: ke.altKey });
      };
      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('keyup', onKeyUp);
      listeners.push(
        { type: 'keydown', fn: onKeyDown as EventListener },
        { type: 'keyup',   fn: onKeyUp   as EventListener },
      );
    }

    captureListenersRef.current = listeners;
    setIsControllingTarget(true);
    setGrantedControlTargetId(targetId);
    setGrantedAccessType(accessType);
    setControlLogs(prev => [...prev, `[Chaperone] ✅ Input capture ACTIVE — injecting ${accessType} inputs into remote session`]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tear down all capture listeners (called on stop, override, or revoke)
  const stopInputCapture = useCallback(() => {
    captureListenersRef.current.forEach(({ type, fn }) => document.removeEventListener(type, fn));
    captureListenersRef.current = [];
    grantedTargetRef.current = null;
    setIsControllingTarget(false);
    setGrantedControlTargetId(null);
  }, []);

  // ── INPUT INJECTION (Host side) ──────────────────────────────────────────────
  // Synthesize DOM events from the requester's relayed payload.
  // Uses the currently focused element or document.body as injection target.
  const injectRemoteInput = useCallback((inputType: string, payload: Record<string, unknown>) => {
    const target = (document.activeElement && document.activeElement !== document.body)
      ? document.activeElement
      : document.elementFromPoint(payload.x as number, payload.y as number) || document.body;

    if (inputType === 'mousemove' || inputType === 'mousedown' || inputType === 'mouseup' || inputType === 'click') {
      const evt = new MouseEvent(inputType, {
        bubbles: true, cancelable: true,
        clientX: payload.x as number, clientY: payload.y as number,
        screenX: payload.screenX as number || 0,
        screenY: payload.screenY as number || 0,
        button: payload.button as number || 0,
        buttons: inputType === 'mousedown' ? 1 : 0,
      });
      // Mark as synthetic so override listeners can distinguish physical input
      Object.defineProperty(evt, '__synthetic', { value: true });
      target.dispatchEvent(evt);
    }
    if (inputType === 'keydown' || inputType === 'keyup') {
      const evt = new KeyboardEvent(inputType, {
        bubbles: true, cancelable: true,
        key: payload.key as string,
        code: payload.code as string,
        ctrlKey: !!payload.ctrlKey, shiftKey: !!payload.shiftKey, altKey: !!payload.altKey,
      });
      Object.defineProperty(evt, '__synthetic', { value: true });
      (document.activeElement || document.body).dispatchEvent(evt);
    }
  }, []);

  // ── HOST OVERRIDE DETECTION (Host side) ──────────────────────────────────────
  // Attach capture-phase listeners that fire BEFORE any injected synthetic events.
  // If the event is NOT synthetic, the host has physically touched their device —
  // immediately emit control_override to the server.
  const startOverrideDetection = useCallback((requesterId: string) => {
    stopOverrideDetection();
    controlledByRef.current = requesterId;

    const detect = (e: Event) => {
      // Skip events we ourselves dispatched synthetically
      if ((e as { __synthetic?: boolean }).__synthetic) return;
      // Host physically touched mouse or keyboard — override immediately
      console.log('[Chaperone] Host physical input detected — overriding remote control');
      socketRef.current?.emit('control_override', { requesterId });
      stopOverrideDetection();
      setControlledBy(null);
      setRemoteControlledBy(null);
      controlledByRef.current = null;
      setControlLogs(prev => [...prev, '[Chaperone] 🖐 Host physical input detected — remote control revoked']);
    };

    const types = ['mousedown', 'keydown'];
    types.forEach(type => {
      // capture: true ensures this fires before any bubbled synthetic event handlers
      document.addEventListener(type, detect, { capture: true });
    });
    overrideListenersRef.current = types.map(type => ({ type, fn: detect as EventListener }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopOverrideDetection = useCallback(() => {
    overrideListenersRef.current.forEach(({ type, fn }) => {
      document.removeEventListener(type, fn, { capture: true } as EventListenerOptions);
    });
    overrideListenersRef.current = [];
  }, []);

  // ── REMOTE CONTROL API HANDSHAKES (Chaperone protocol) ───────────────────────
  const requestRemoteControl = (targetId: string, accessType: 'mouse' | 'keyboard' | 'both' = 'both') => {
    setIsRemoteControlRequested(true);
    socketRef.current?.emit('control_request', { targetId, requesterName: myAliasRef.current.name, accessType });
    setControlLogs(prev => [...prev, `[System] Sent remote control request (${accessType}) to client ${targetId}`]);
  };

  const respondToControlRequest = (requesterId: string, approved: boolean, level: 'none' | 'view' | 'interact' | 'full' = 'none') => {
    socketRef.current?.emit('control_response', { requesterId, approved, level });
    setPendingControlRequestFrom(null);
    if (approved) {
      setControlledBy(requesterId);
      setRemoteControlledBy(requesterId);
      controlledByRef.current = requesterId;
      // Activate host override detection with capture-phase listeners
      startOverrideDetection(requesterId);
      setControlLogs(prev => [...prev, `[Chaperone] ✅ Approved remote session control (Level: ${level}) — override detection armed`]);
    } else {
      setControlLogs(prev => [...prev, `[Chaperone] Denied remote control request`]);
    }
  };

  const triggerEmergencyKill = () => {
    socketRef.current?.emit('control_revoke');
    stopInputCapture();
    stopOverrideDetection();
    setControlledBy(null);
    setRemoteControlledBy(null);
    setIsControllingTarget(false);
    controlledByRef.current = null;
    setControlLogs(prev => [...prev, `[EMERGENCY] Revoked all active remote session privileges instantly`]);
  };

  // Dynamic Camera Track Swapping
  useEffect(() => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack && selectedVideoDeviceId && selectedVideoDeviceId !== 'default') {
      const currentSettings = videoTrack.getSettings();
      if (currentSettings.deviceId !== selectedVideoDeviceId) {
        navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: selectedVideoDeviceId } }
        }).then(newStream => {
          const newTrack = newStream.getVideoTracks()[0];
          localStream.removeTrack(videoTrack);
          videoTrack.stop();
          localStream.addTrack(newTrack);
          Object.values(peerConnectionsRef.current).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track?.kind === 'video');
            if (sender) {
              sender.replaceTrack(newTrack);
            }
          });
        }).catch(err => console.error("Failed to dynamically switch video device:", err));
      }
    }
  }, [selectedVideoDeviceId, localStream]);

  // Dynamic Microphone Track Swapping
  useEffect(() => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack && selectedAudioDeviceId && selectedAudioDeviceId !== 'default') {
      const currentSettings = audioTrack.getSettings();
      if (currentSettings.deviceId !== selectedAudioDeviceId) {
        navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: selectedAudioDeviceId } }
        }).then(newStream => {
          const newTrack = newStream.getAudioTracks()[0];
          localStream.removeTrack(audioTrack);
          audioTrack.stop();
          localStream.addTrack(newTrack);
          Object.values(peerConnectionsRef.current).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
            if (sender) {
              sender.replaceTrack(newTrack);
            }
          });
        }).catch(err => console.error("Failed to dynamically switch audio device:", err));
      }
    }
  }, [selectedAudioDeviceId, localStream]);

  // BUG FIX #1 (Core Fix): Remove `myAlias` from the dependency array entirely.
  // The socket connection must persist across alias changes — we use myAliasRef
  // to read the current alias at the moment of connection without needing it
  // as a reactive dependency.
  useEffect(() => {
    const token = sessionStorage.getItem('nexalink_token');
    if (!token) return;

    const socket = io(WS_URL, {
      autoConnect: true,
      transports: ['websocket'],
      auth: {
        token,
      },
    });
    socketRef.current = socket;
    setSocket(socket);

    socket.on('connect', () => {
      setIsConnected(true);
      if (roomName) {
        socket.emit('join_room', { roomName, userAlias: { ...myAliasRef.current, isSharingScreen: !!screenStream } });
      }
      if (iceServers) {
        console.log('[WebRTC] Active ICE configuration loaded for call context:', iceServers);
      }
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('participants_changed', (updatedList: Participant[]) => {
      setParticipants(updatedList.filter(p => p.id !== socket.id));
    });

    socket.on('control_requested', ({ requesterId, requesterName, accessType }) => {
      setPendingControlRequestFrom(requesterId);
      setPendingControlRequestType(accessType || 'both');
      setControlLogs(prev => [...prev, `[Chaperone] Incoming remote control query (${accessType || 'both'}) from ${requesterName}`]);
    });

    socket.on('control_approved', ({ level }) => {
      setIsRemoteControlRequested(false);
      const targetId = grantedTargetRef.current;
      const accessType = grantedAccessTypeRef.current;
      if (targetId) {
        startInputCapture(targetId, accessType);
      }
      setControlLogs(prev => [...prev, `[System] ✅ Control approved (Level: ${level}) — input capture started`]);
    });

    socket.on('control_denied', () => {
      setIsRemoteControlRequested(false);
      grantedTargetRef.current = null;
      setControlLogs(prev => [...prev, `[Warning] Remote control request was rejected by host`]);
    });

    socket.on('remote_input', ({ inputType, payload }: { senderId: string; inputType: string; payload: Record<string, unknown> }) => {
      injectRemoteInput(inputType, payload);
    });

    socket.on('control_overridden', ({ hostId }: { hostId: string }) => {
      stopInputCapture();
      setIsRemoteControlRequested(false);
      setIsHostOverrideActive(true);
      setControlLogs(prev => [...prev, `[Chaperone] 🖐 Host <${hostId}> physically took back control — input capture stopped`]);
      setTimeout(() => setIsHostOverrideActive(false), 3000);
    });

    socket.on('control_revoked', () => {
      stopInputCapture();
      stopOverrideDetection();
      setControlledBy(null);
      setRemoteControlledBy(null);
      setIsControllingTarget(false);
      controlledByRef.current = null;
      setControlLogs(prev => [...prev, `[Revoked] Host triggered emergency kill-switch`]);
    });

    let prevBytesSent = 0;
    let prevBytesReceived = 0;
    let prevTimestamp = Date.now();

    const interval = setInterval(async () => {
      const pcs = Object.values(peerConnectionsRef.current);
      
      // Read simulation parameters from refs to avoid stale closure
      const currentSimProfile = simulatedProfileRef.current;
      const currentCustomSettings = customSimSettingsRef.current;

      let simulatedLoss = 0;
      let simulatedLatency = 30;
      let simulatedJitter = 2.0;

      if (currentSimProfile === 'auto-drift') {
        const timeSec = Math.floor(Date.now() / 1000);
        const isSimulatedDegraded = (timeSec % 60) > 40; // Degrade for 20 seconds out of every 60 seconds
        simulatedLoss = isSimulatedDegraded ? Math.floor(8 + Math.random() * 15) : (Math.random() > 0.95 ? 2 : 0);
        simulatedLatency = isSimulatedDegraded ? Math.floor(220 + Math.random() * 120) : Math.floor(35 + Math.random() * 20);
        simulatedJitter = isSimulatedDegraded ? Math.floor(25 + Math.random() * 15) : Math.floor(2 + Math.random() * 4);
      } else if (currentSimProfile === 'fiber') {
        simulatedLoss = 0;
        simulatedLatency = Math.floor(12 + Math.random() * 8);
        simulatedJitter = Math.floor(1 + Math.random() * 2);
      } else if (currentSimProfile === 'lte') {
        simulatedLoss = Math.floor(2 + Math.random() * 4);
        simulatedLatency = Math.floor(80 + Math.random() * 50);
        simulatedJitter = Math.floor(12 + Math.random() * 12);
      } else if (currentSimProfile === 'satellite') {
        simulatedLoss = Math.floor(15 + Math.random() * 15);
        simulatedLatency = Math.floor(550 + Math.random() * 300);
        simulatedJitter = Math.floor(50 + Math.random() * 60);
      } else if (currentSimProfile === 'custom') {
        const lossVariance = currentCustomSettings.packetLoss > 0 ? (Math.random() * 2 - 1) : 0;
        const latencyVariance = Math.random() * 10 - 5;
        const jitterVariance = Math.random() * 2 - 1;

        simulatedLoss = Math.max(0, Math.round(currentCustomSettings.packetLoss + lossVariance));
        simulatedLatency = Math.max(5, Math.round(currentCustomSettings.latency + latencyVariance));
        simulatedJitter = Math.max(0.5, Math.round((currentCustomSettings.jitter + jitterVariance) * 10) / 10);
      }

      if (pcs.length === 0) {
        // Fallback to safe simulated baseline if no peer is connected yet
        const localStats = {
          videoLatency: simulatedLatency,
          audioLatency: Math.floor(simulatedLatency * 0.6),
          packetLoss: simulatedLoss,
          jitter: simulatedJitter,
          bytesSent: 0,
          bytesReceived: 0,
          bitrateSent: 0,
          bitrateReceived: 0,
          videoFps: simulatedLoss > 12 ? 10 : 30,
          audioCodec: 'opus',
          videoCodec: 'VP8',
          localCandidateType: 'host/relay',
          remoteCandidateType: 'srflx/relay',
          transportType: 'dtls',
        };
        setStats(localStats);

        // Run ABR on simulated stats
        runABRDecision(simulatedLoss, simulatedLatency, simulatedJitter);
        return;
      }

      // We will aggregate stats across all active peer connections
      let totalVideoLatency = 0;
      let totalAudioLatency = 0;
      let totalJitter = 0;
      let totalPacketsLost = 0;
      let totalPacketsReceived = 0;
      let totalBytesSent = 0;
      let totalBytesReceived = 0;
      let videoFps = 0;
      let audioCodec = '';
      let videoCodec = '';
      let localCandidateType = '';
      let remoteCandidateType = '';
      let transportType = '';

      let pcCount = 0;

      for (const pc of pcs) {
        if (pc.connectionState !== 'connected') continue;
        pcCount++;
        try {
          const report = await pc.getStats();
          report.forEach(stat => {
            // Check candidate-pair for RTT (Round Trip Time)
            if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
              const rtt = stat.currentRoundTripTime ? stat.currentRoundTripTime * 1000 : 0; // convert to ms
              if (rtt > 0) {
                totalVideoLatency += rtt;
                totalAudioLatency += rtt * 0.6; // Audio typically lower buffer
              }
              if (stat.localCandidateId) {
                const localCand = report.get(stat.localCandidateId);
                if (localCand) {
                  localCandidateType = localCand.candidateType || localCand.protocol || '';
                }
              }
              if (stat.remoteCandidateId) {
                const remoteCand = report.get(stat.remoteCandidateId);
                if (remoteCand) {
                  remoteCandidateType = remoteCand.candidateType || remoteCand.protocol || '';
                }
              }
            }

            // Inbound RTP stats (for packet loss, jitter, codecs, resolution/fps)
            if (stat.type === 'inbound-rtp') {
              if (stat.kind === 'video') {
                videoFps = stat.framesPerSecond || videoFps;
                if (stat.codecId) {
                  const codec = report.get(stat.codecId);
                  if (codec) {
                    videoCodec = codec.mimeType || '';
                  }
                }
              }
              if (stat.kind === 'audio') {
                if (stat.codecId) {
                  const codec = report.get(stat.codecId);
                  if (codec) {
                    audioCodec = codec.mimeType || '';
                  }
                }
              }
              totalJitter += (stat.jitter || 0) * 1000; // convert to ms
              totalPacketsLost += stat.packetsLost || 0;
              totalPacketsReceived += stat.packetsReceived || 0;
              totalBytesReceived += stat.bytesReceived || 0;
            }

            // Outbound RTP stats
            if (stat.type === 'outbound-rtp') {
              totalBytesSent += stat.bytesSent || 0;
            }

            // Transport details
            if (stat.type === 'transport') {
              transportType = stat.dtlsState || stat.selectedCandidatePairChanges || '';
            }
          });
        } catch (e) {
          console.error('[WebRTC Stats Error]', e);
        }
      }

      if (pcCount > 0) {
        const now = Date.now();
        const timeDiffSec = (now - prevTimestamp) / 1000;
        
        let bitrateSent = 0;
        let bitrateReceived = 0;

        if (timeDiffSec > 0) {
          // Bitrate in kbps (bytes * 8 / 1000 / seconds)
          const sentDiff = Math.max(0, totalBytesSent - prevBytesSent);
          const recvDiff = Math.max(0, totalBytesReceived - prevBytesReceived);
          bitrateSent = Math.round((sentDiff * 8) / 1000 / timeDiffSec);
          bitrateReceived = Math.round((recvDiff * 8) / 1000 / timeDiffSec);
        }

        prevBytesSent = totalBytesSent;
        prevBytesReceived = totalBytesReceived;
        prevTimestamp = now;

        const packetLossCalc = (totalPacketsReceived + totalPacketsLost) > 0
          ? Math.round((totalPacketsLost / (totalPacketsReceived + totalPacketsLost)) * 100)
          : 0;

        let finalLoss = packetLossCalc;
        let finalLatency = Math.round(totalVideoLatency / pcCount) || 35;
        let finalJitter = Math.round((totalJitter / pcCount) * 10) / 10 || 2.2;

        if (currentSimProfile !== 'auto-drift') {
          finalLoss = simulatedLoss;
          finalLatency = simulatedLatency;
          finalJitter = simulatedJitter;
        }

        const calculatedStats = {
          videoLatency: finalLatency,
          audioLatency: Math.floor(finalLatency * 0.6),
          packetLoss: finalLoss,
          jitter: finalJitter,
          bytesSent: totalBytesSent,
          bytesReceived: totalBytesReceived,
          bitrateSent,
          bitrateReceived,
          videoFps: videoFps || (finalLoss > 12 ? 10 : 30),
          audioCodec: audioCodec.replace('audio/', '') || 'opus',
          videoCodec: videoCodec.replace('video/', '') || 'VP8',
          localCandidateType: localCandidateType || 'host/relay',
          remoteCandidateType: remoteCandidateType || 'srflx/relay',
          transportType: transportType || 'dtls',
        };
        setStats(calculatedStats);

        // Run ABR on stats
        runABRDecision(finalLoss, finalLatency, finalJitter);
      } else {
        // Fallback simulated block
        setStats({
          videoLatency: simulatedLatency,
          audioLatency: Math.floor(simulatedLatency * 0.6),
          packetLoss: simulatedLoss,
          jitter: simulatedJitter,
          bytesSent: 0,
          bytesReceived: 0,
          bitrateSent: 0,
          bitrateReceived: 0,
          videoFps: simulatedLoss > 12 ? 10 : 30,
          audioCodec: 'opus',
          videoCodec: 'VP8',
          localCandidateType: 'host/relay',
          remoteCandidateType: 'srflx/relay',
          transportType: 'dtls',
        });
        runABRDecision(simulatedLoss, simulatedLatency, simulatedJitter);
      }
    }, 2000);

    // Dynamic ABR Decision engine
    function runABRDecision(resolvedLoss: number, resolvedLatency: number, resolvedJitter: number) {
      if (qualityPreference !== 'auto') return;

      let targetProfile: 'hd' | 'sd' | 'low' | 'audio-only' = 'hd';

      // Threshold evaluations
      if (resolvedLoss > 18 || resolvedLatency > 500) {
        targetProfile = 'audio-only';
      } else if (resolvedLoss > 10 || resolvedLatency > 300 || resolvedJitter > 45) {
        targetProfile = 'low';
      } else if (resolvedLoss > 4 || resolvedLatency > 150 || resolvedJitter > 20) {
        targetProfile = 'sd';
      } else {
        targetProfile = 'hd';
      }

      // Hysteresis / Debouncing logic
      const currentProfile = lastProfileRef.current;
      if (targetProfile !== currentProfile) {
        const isDegradation = 
          (targetProfile === 'audio-only') ||
          (targetProfile === 'low' && currentProfile !== 'audio-only') ||
          (targetProfile === 'sd' && currentProfile === 'hd');

        if (isDegradation) {
          consecutiveDegradationRef.current += 1;
          consecutiveRecoveryRef.current = 0;

          // Degrade instantly on 1 degraded packet-loss/latency sample to prevent audio cuts or freezing
          if (consecutiveDegradationRef.current >= 1) {
            setCurrentQualityProfile(targetProfile);
            lastProfileRef.current = targetProfile;
            consecutiveDegradationRef.current = 0;

            const logMessage = `[ABR] ⚠️ Network degraded (Loss: ${resolvedLoss}%, Latency: ${resolvedLatency}ms). Auto-scaled video quality to ${
              targetProfile === 'audio-only' ? 'Audio Only' : targetProfile === 'low' ? 'Low Bandwidth (240p)' : 'Standard Definition (480p)'
            }.`;
            setControlLogs(prev => [...prev, logMessage]);
            console.log(logMessage);
            applyQualitySettings(targetProfile);
          }
        } else {
          consecutiveRecoveryRef.current += 1;
          consecutiveDegradationRef.current = 0;

          // Recover slowly (requires 2 consecutive optimal samples) to ensure recovery is stable
          if (consecutiveRecoveryRef.current >= 2) {
            setCurrentQualityProfile(targetProfile);
            lastProfileRef.current = targetProfile;
            consecutiveRecoveryRef.current = 0;

            const logMessage = `[ABR] 🚀 Network stabilized (Loss: ${resolvedLoss}%, Latency: ${resolvedLatency}ms). Auto-scaled video quality to ${
              targetProfile === 'hd' ? 'High Definition (720p/1080p)' : targetProfile === 'sd' ? 'Standard Definition (480p)' : 'Low Bandwidth (240p)'
            }.`;
            setControlLogs(prev => [...prev, logMessage]);
            console.log(logMessage);
            applyQualitySettings(targetProfile);
          }
        }
      }
    }

    return () => {
      socket.disconnect();
      clearInterval(interval);
      stopInputCapture();
      stopOverrideDetection();
      Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
      peerConnectionsRef.current = {};
      socketRef.current = null;
      setSocket(null);
    };
  }, [startInputCapture, stopInputCapture, stopOverrideDetection, injectRemoteInput, defaultName, qualityPreference, applyQualitySettings]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;

    if (roomName) {
      socket.emit('join_room', { roomName, userAlias: { ...myAliasRef.current, isSharingScreen: !!screenStream } });
    } else {
      socket.emit('leave_room');
      setParticipants([]);
    }
  }, [roomName, screenStream]);

  // Clean up all local media streams (camera/mic/screen) when the user leaves the room
  useEffect(() => {
    if (!roomName) {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        setLocalStream(null);
      }
      if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        setScreenStream(null);
      }
      setAudioEnabled(false);
      setVideoEnabled(false);
    }
  }, [roomName]);

  // BUG FIX #2: Expose the reactive socket state so consumers are notified when the connection is established.
  return {
    socket,
    isConnected,
    localStream,
    screenStream,
    audioEnabled,
    videoEnabled,
    participants,
    myAlias,
    isAliasEnabled,
    stats,
    controlledBy,
    isRemoteControlRequested,
    pendingControlRequestFrom,
    pendingControlRequestType,
    controlLogs,
    // Active control session
    isControllingTarget,
    grantedControlTargetId,
    grantedAccessType,
    remoteControlledBy,
    isHostOverrideActive,
    // Quality settings
    qualityPreference,
    setQualityPreference,
    currentQualityProfile,
    // Simulation Lab
    simulatedProfile,
    setSimulatedProfile,
    customSimSettings,
    setCustomSimSettings,
    // Actions
    initMedia,
    toggleVideo,
    toggleAudio,
    toggleScreenShare,
    toggleAlias,
    requestRemoteControl,
    respondToControlRequest,
    triggerEmergencyKill,
    stopInputCapture,
  };
}
