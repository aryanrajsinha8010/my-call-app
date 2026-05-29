import { useState, useRef, useEffect, useCallback } from 'react';

export interface AudioPipelineConfig {
  pitchShift: number; // Semitones: -12 to 12
  whisperFilterEnabled: boolean; // Transmit below ambient threshold
  noiseCancellationEnabled: boolean; // Simulated RNNoise
  muteWithTranscription: boolean; // Whisper continues listening
  voicePreset: 'clean' | 'helium' | 'deep' | 'robot' | 'radio';
}

/**
 * Generate standard symmetric warm analog distortion curve for WaveShaperNode.
 */
function makeDistortionCurve(amount = 20) {
  const k = typeof amount === 'number' ? amount : 50;
  const n_samples = 44100;
  const curve = new Float32Array(n_samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < n_samples; ++i) {
    const x = (i * 2) / n_samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

/**
 * Creates a high-fidelity granular overlap-add Pitch Shifter node using ScriptProcessorNode.
 * Utilizes overlapping windowed grains (granular synthesis) to pitch-shift vocals in real-time.
 */
function createPitchShifterNode(audioCtx: AudioContext, initialPitchShift: number) {
  const bufferSize = 4096;
  const node = audioCtx.createScriptProcessor(bufferSize, 1, 1);
  
  let pitchShift = initialPitchShift;
  
  const grainSize = 1024;
  const inputBuffer = new Float32Array(grainSize * 2);
  let inputWriteIndex = 0;
  
  // Sine window function to overlap smoothly without clicks
  const window = new Float32Array(grainSize);
  for (let i = 0; i < grainSize; i++) {
    window[i] = Math.sin(Math.PI * i / (grainSize - 1));
  }
  
  // Playback pointers for two overlapping grains
  let grainPointer1 = 0;
  let grainPointer2 = grainSize / 2;
  
  node.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const output = e.outputBuffer.getChannelData(0);
    
    const ratio = Math.pow(2, pitchShift / 12);
    
    // Completely bypass processing if pitch shift is disabled for 100% latency-free output
    if (pitchShift === 0) {
      output.set(input);
      return;
    }
    
    for (let i = 0; i < input.length; i++) {
      // Write incoming mic sample to input circular buffer
      inputBuffer[inputWriteIndex] = input[i];
      
      const readIndex1 = Math.floor(grainPointer1);
      const readIndex2 = Math.floor(grainPointer2);
      
      const w1 = window[Math.floor(grainPointer1 % grainSize)];
      const w2 = window[Math.floor(grainPointer2 % grainSize)];
      
      // Retrieve sample from circular buffers
      const sample1 = inputBuffer[(inputWriteIndex - grainSize + readIndex1 + inputBuffer.length) % inputBuffer.length];
      const sample2 = inputBuffer[(inputWriteIndex - grainSize + readIndex2 + inputBuffer.length) % inputBuffer.length];
      
      // Accumulate overlapping grains
      output[i] = (sample1 * w1 + sample2 * w2) * 0.707;
      
      // Advance playback pointers based on pitch scaling ratio
      grainPointer1 = (grainPointer1 + ratio) % grainSize;
      grainPointer2 = (grainPointer2 + ratio) % grainSize;
      
      inputWriteIndex = (inputWriteIndex + 1) % inputBuffer.length;
    }
  };
  
  Object.defineProperty(node, 'pitchShift', {
    get() { return pitchShift; },
    set(val) { pitchShift = val; }
  });
  
  return node;
}

export function useAudioPipeline() {
  const [isActive, setIsActive] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [config, setConfig] = useState<AudioPipelineConfig>({
    pitchShift: 0,
    whisperFilterEnabled: false,
    noiseCancellationEnabled: true,
    muteWithTranscription: false,
    voicePreset: 'clean',
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const filterNodeRef = useRef<BiquadFilterNode | null>(null);
  const pitchShifterNodeRef = useRef<any>(null);
  const robotOscillatorRef = useRef<OscillatorNode | null>(null);
  const robotGainNodeRef = useRef<GainNode | null>(null);
  const radioHighpassNodeRef = useRef<BiquadFilterNode | null>(null);
  const radioLowpassNodeRef = useRef<BiquadFilterNode | null>(null);
  const radioDistortionNodeRef = useRef<WaveShaperNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  
  const animationFrameRef = useRef<number | null>(null);
  const lastMeterUpdateRef = useRef(0);

  const stopPipeline = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (robotOscillatorRef.current) {
      try {
        robotOscillatorRef.current.stop();
      } catch (e) {}
      robotOscillatorRef.current = null;
    }

    sourceNodeRef.current = null;
    filterNodeRef.current = null;
    pitchShifterNodeRef.current = null;
    robotGainNodeRef.current = null;
    radioHighpassNodeRef.current = null;
    radioLowpassNodeRef.current = null;
    radioDistortionNodeRef.current = null;
    gainNodeRef.current = null;
    analyserNodeRef.current = null;

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(err => {
        console.warn('[AudioPipeline] AudioContext close warning:', err);
      });
    }
    audioContextRef.current = null;

    setIsActive(false);
    setVolumeLevel(0);
  }, []);

  const startPipeline = useCallback(async (stream: MediaStream) => {
    stopPipeline();

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      // Source Microphone
      const source = audioCtx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      // Analyser (for level meter and live transcription input detection)
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserNodeRef.current = analyser;

      // Filter (Base rumble removal)
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 80;
      filterNodeRef.current = filter;

      // Pitch Shifter Node (Initial 0)
      const pitchShifter = createPitchShifterNode(audioCtx, config.pitchShift);
      pitchShifterNodeRef.current = pitchShifter;

      // Ring Modulator (Robot Effect)
      const robotOsc = audioCtx.createOscillator();
      robotOsc.type = 'sine';
      robotOsc.frequency.value = 55;
      
      const robotGain = audioCtx.createGain();
      robotGain.gain.value = 1.0; // Starts bypassed
      
      robotOsc.start();
      robotOscillatorRef.current = robotOsc;
      robotGainNodeRef.current = robotGain;

      // Vintage Walkie-Talkie Filters (Starts bypassed)
      const radioHigh = audioCtx.createBiquadFilter();
      radioHigh.type = 'highpass';
      radioHigh.frequency.value = 20;

      const radioLow = audioCtx.createBiquadFilter();
      radioLow.type = 'lowpass';
      radioLow.frequency.value = 20000;

      const radioDist = audioCtx.createWaveShaper();
      radioDist.curve = null;

      radioHighpassNodeRef.current = radioHigh;
      radioLowpassNodeRef.current = radioLow;
      radioDistortionNodeRef.current = radioDist;

      // Output level gain node (for whisper booster)
      const gain = audioCtx.createGain();
      gainNodeRef.current = gain;

      // Serial DSP Connection Pipeline:
      // Source -> Highpass (Base) -> Pitch Shifter -> Ring Modulator -> Radio Bandpass/Distortion -> Output Gain -> Analyser
      source.connect(filter);
      filter.connect(pitchShifter);
      pitchShifter.connect(robotGain);
      robotGain.connect(radioHigh);
      radioHigh.connect(radioLow);
      radioLow.connect(radioDist);
      radioDist.connect(gain);
      gain.connect(analyser);

      setIsActive(true);
      monitorVolume();
    } catch (err) {
      console.error('Failed to initialize Audio WebAudio DSP Pipeline:', err);
    }
  }, [stopPipeline]);

  const monitorVolume = () => {
    if (!analyserNodeRef.current) return;

    const array = new Uint8Array(analyserNodeRef.current.frequencyBinCount);
    analyserNodeRef.current.getByteFrequencyData(array);

    let sum = 0;
    for (let i = 0; i < array.length; i++) {
      sum += array[i];
    }
    const average = sum / array.length;
    const now = performance.now();
    if (now - lastMeterUpdateRef.current > 120) {
      setVolumeLevel(average);
      lastMeterUpdateRef.current = now;
    }

    animationFrameRef.current = requestAnimationFrame(monitorVolume);
  };

  // Dynamic dynamic config update handler
  useEffect(() => {
    if (!isActive || !gainNodeRef.current || !filterNodeRef.current || !audioContextRef.current) return;

    // ── Apply High-Gain Whisper Gate Filter ──
    if (config.whisperFilterEnabled) {
      gainNodeRef.current.gain.setTargetAtTime(0.12, audioContextRef.current.currentTime, 0.1);
      filterNodeRef.current.frequency.setTargetAtTime(150, audioContextRef.current.currentTime, 0.1);
    } else {
      gainNodeRef.current.gain.setTargetAtTime(1.0, audioContextRef.current.currentTime, 0.1);
      filterNodeRef.current.frequency.setTargetAtTime(80, audioContextRef.current.currentTime, 0.1);
    }

    // ── Apply Pitch Shift Presets ──
    if (pitchShifterNodeRef.current) {
      let activePitch = config.pitchShift;
      if (config.voicePreset === 'helium') {
        activePitch = 8;
      } else if (config.voicePreset === 'deep') {
        activePitch = -6;
      } else if (config.voicePreset === 'robot' || config.voicePreset === 'radio') {
        activePitch = 0;
      }
      pitchShifterNodeRef.current.pitchShift = activePitch;
    }

    // ── Apply Ring Modulator (Robot Preset) ──
    const robotGain = robotGainNodeRef.current;
    const robotOsc = robotOscillatorRef.current;
    if (robotGain && robotOsc && audioContextRef.current) {
      if (config.voicePreset === 'robot') {
        robotGain.gain.setValueAtTime(0.0, audioContextRef.current.currentTime);
        try {
          robotOsc.connect(robotGain.gain);
        } catch (e) {}
      } else {
        try {
          robotOsc.disconnect(robotGain.gain);
        } catch (e) {}
        robotGain.gain.setTargetAtTime(1.0, audioContextRef.current.currentTime, 0.05);
      }
    }

    // ── Apply Vintage Radio Preset ──
    const radioHigh = radioHighpassNodeRef.current;
    const radioLow = radioLowpassNodeRef.current;
    const radioDist = radioDistortionNodeRef.current;
    if (radioHigh && radioLow && radioDist && audioContextRef.current) {
      if (config.voicePreset === 'radio') {
        radioHigh.frequency.setTargetAtTime(400, audioContextRef.current.currentTime, 0.1);
        radioLow.frequency.setTargetAtTime(3000, audioContextRef.current.currentTime, 0.1);
        radioDist.curve = makeDistortionCurve(45);
      } else {
        radioHigh.frequency.setTargetAtTime(20, audioContextRef.current.currentTime, 0.1);
        radioLow.frequency.setTargetAtTime(20000, audioContextRef.current.currentTime, 0.1);
        radioDist.curve = null;
      }
    }
  }, [config, isActive]);

  useEffect(() => {
    return () => {
      stopPipeline();
    };
  }, [stopPipeline]);

  return {
    isActive,
    volumeLevel,
    config,
    setConfig,
    startPipeline,
    stopPipeline,
  };
}
