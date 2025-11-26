(function() {
  const synthRoot = document.querySelector('.synth');
  if (!synthRoot) return;

  const waveButtons = Array.from(synthRoot.querySelectorAll('.synth-wave-button'));
  const filterSlider = /** @type {HTMLInputElement | null} */ (document.getElementById('synthFilterFrequency'));
  const filterValueLabel = document.getElementById('synthFilterFrequencyValue');
  const pitchSlider = /** @type {HTMLInputElement | null} */ (document.getElementById('synthPitch'));
  const pitchValueLabel = document.getElementById('synthPitchValue');
  const lfoSlider = /** @type {HTMLInputElement | null} */ (document.getElementById('synthLfoRate'));
  const lfoValueLabel = document.getElementById('synthLfoRateValue');
  const lfoIndicator = synthRoot.querySelector('[data-synth-lfo-indicator]');
  const lfoDepthSlider = /** @type {HTMLInputElement | null} */ (document.getElementById('synthLfoDepth'));
  const lfoDepthValueLabel = document.getElementById('synthLfoDepthValue');
  const scopeCanvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('synthScope'));
  const statusText = synthRoot.querySelector('[data-synth-status]');

  /**
   * Updates the knob indicator rotation based on slider value.
   * Maps slider value [0, 1] to angle [-135°, 135°] for typical synth knob feel.
   * @param {HTMLInputElement} slider
   */
  function updateKnobIndicator(slider) {
    const indicator = slider.parentElement?.querySelector('[data-knob-indicator]');
    if (!indicator) return;
    const value = parseFloat(slider.value) || 0;
    // Map [0, 1] to [-135, 135] degrees
    const angle = (value - 0.5) * 270;
    indicator.style.setProperty('--knob-angle', angle + 'deg');
  }

  /**
   * Initialize all knob indicators
   */
  function initAllKnobIndicators() {
    const allSliders = [filterSlider, pitchSlider, lfoSlider, lfoDepthSlider];
    allSliders.forEach(function(slider) {
      if (slider) updateKnobIndicator(slider);
    });
  }

  if (
    waveButtons.length === 0 ||
    !filterSlider ||
    !filterValueLabel ||
    !pitchSlider ||
    !pitchValueLabel ||
    !lfoSlider ||
    !lfoValueLabel ||
    !lfoDepthSlider ||
    !lfoDepthValueLabel ||
    !scopeCanvas
  ) {
    if (statusText) {
      statusText.textContent = 'Mini synth UI could not be initialized.';
    }
    return;
  }

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    if (statusText) {
      statusText.textContent = 'Web Audio API is not available in this browser.';
    }
    scopeCanvas.style.display = 'none';
    waveButtons.forEach(function(btn) { btn.disabled = true; });
    filterSlider.disabled = true;
    return;
  }

  /** @type {AudioContext | null} */
  let audioCtx = null;
  /** @type {OscillatorNode | null} */
  let oscNode = null;
  /** @type {BiquadFilterNode | null} */
  let filterNode = null;
  /** @type {GainNode | null} */
  let gainNode = null;
  /** @type {AnalyserNode | null} */
  let analyserNode = null;
  /** @type {OscillatorNode | null} */
  let lfoNode = null;
  /** @type {GainNode | null} */
  let lfoGainNode = null;

  /** @type {number | null} */
  let animationFrameId = null;
  let currentWave = 'sine';
  let muted = true;
  let simulatedTime = 0; // For synthetic waveform animation

  const minFreq = 100;
  const maxFreq = 20000;
  let lfoFrequency = 0.0;
  let baseCutoffHz = 0;
  let lfoDepthFactor = 0.45; // LFO depth as a fraction of the base cutoff

  /**
   * @returns {AudioContext}
   */
  function ensureAudioContext() {
    if (!audioCtx) {
      audioCtx = new AudioCtx();
    }
    // Don't resume here synchronously - let ensureSynthRunning handle it
    return audioCtx;
  }

  function createGraph() {
    const ctx = ensureAudioContext();
    filterNode = ctx.createBiquadFilter();
    filterNode.type = 'lowpass';

    gainNode = ctx.createGain();
    gainNode.gain.value = 0.16;

    analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.7;

    // Signal flows: osc -> filter -> gain -> analyser
    // Analyser is NOT connected to destination initially (muted)
    filterNode.connect(gainNode);
    gainNode.connect(analyserNode);
    // Don't connect to destination yet - start muted

    // LFO for filter cutoff
    lfoNode = ctx.createOscillator();
    lfoNode.type = 'sine';
    lfoGainNode = ctx.createGain();
    lfoGainNode.gain.value = 4000; // modulation depth in Hz
    lfoNode.connect(lfoGainNode);
    lfoGainNode.connect(filterNode.frequency);
    lfoNode.start();
    // Initialize LFO frequency based on current slider.
    updateLfoFromSlider();
  }

  function unmute() {
    if (!muted || !analyserNode || !audioCtx) return;
    analyserNode.connect(audioCtx.destination);
    muted = false;
    updateMuteButton();
  }

  function muteAudio() {
    if (muted || !analyserNode || !audioCtx) return;
    analyserNode.disconnect(audioCtx.destination);
    muted = true;
    updateMuteButton();
  }

  function toggleMute() {
    if (muted) {
      // Need to start synth first, then unmute
      const ctx = ensureAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume().then(function() {
          startSynth();
          unmute();
        });
      } else {
        startSynth();
        unmute();
      }
    } else {
      muteAudio();
    }
  }

  function updateMuteButton() {
    const muteButton = document.getElementById('synthMuteButton');
    if (muteButton) {
      muteButton.textContent = muted ? '🔇 Unmute' : '🔊 Mute';
      muteButton.setAttribute('data-muted', muted ? 'true' : 'false');
    }
  }

  /**
   * @param {string} wave
   */
  function setWaveform(wave) {
    currentWave = wave;
    if (oscNode) {
      oscNode.type = wave;
    }
    waveButtons.forEach(function(btn) {
      const btnWave = btn.getAttribute('data-wave');
      btn.classList.toggle('synth-wave-button--active', btnWave === wave);
    });
  }

  function updateFilterFromSlider() {
    var raw = parseFloat(filterSlider.value);
    if (isNaN(raw)) {
      raw = 0.5;
    }
    const ratio = maxFreq / minFreq;
    const freq = minFreq * Math.pow(ratio, raw);
    baseCutoffHz = freq;
    if (filterNode && audioCtx) {
      filterNode.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.01);
    }
    let label;
    if (freq < 1000) {
      label = Math.round(freq) + ' Hz';
    } else {
      label = (freq / 1000).toFixed(1) + ' kHz';
    }
    filterValueLabel.textContent = label;

    // Whenever the base cutoff changes, update LFO depth so modulation
    // oscillates around the new value instead of cutting off completely.
    updateLfoDepth();
  }

  function updateLfoDepth() {
    if (!lfoGainNode || !audioCtx) return;
    // Clamp factor between 0 and 1.5 for safety.
    const safeFactor = Math.max(0, Math.min(1.5, lfoDepthFactor));
    const depth = baseCutoffHz * safeFactor;
    lfoGainNode.gain.setTargetAtTime(depth, audioCtx.currentTime, 0.02);
  }

  function updateLfoFromSlider() {
    if (!lfoSlider) return;
    var raw = parseFloat(lfoSlider.value);
    if (isNaN(raw)) {
      raw = 0.4;
    }
    // Allow turning LFO off: very low values mean frequency 0 and no modulation.
    if (raw <= 0.01) {
      lfoFrequency = 0;
      if (lfoNode && audioCtx) {
        lfoNode.frequency.setTargetAtTime(0.0, audioCtx.currentTime, 0.02);
      }
      if (lfoGainNode && audioCtx) {
        lfoGainNode.gain.setTargetAtTime(0.0, audioCtx.currentTime, 0.02);
      }
      if (lfoValueLabel) {
        lfoValueLabel.textContent = 'Off';
      }
      return;
    }

    // Map (0.01,1] -> [0.1 Hz, 16 Hz] exponentially for nicer control.
    const min = 0.1;
    const max = 128;
    const ratio = max / min;
    const scaled = (raw - 0.01) / 0.99;
    const freq = min * Math.pow(ratio, scaled);
    lfoFrequency = freq;
    if (lfoNode && audioCtx) {
      lfoNode.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.02);
    }
    if (lfoValueLabel) {
      lfoValueLabel.textContent = freq.toFixed(1) + ' Hz';
    }

    // LFO rate changed; keep depth relative to current base cutoff.
    updateLfoDepth();
  }

  const pitchBaseHz = 187;
  const pitchOctaves = 3; // symmetric up/down

  function updatePitchFromSlider() {
    if (!pitchSlider) return;
    var raw = parseFloat(pitchSlider.value);
    if (isNaN(raw)) {
      raw = 0.5;
    }
    // Map [0,1] around a base of 220 Hz, spanning roughly 55–880 Hz.
    var factor = Math.pow(2, pitchOctaves * (raw - 0.5));
    var freq = pitchBaseHz * factor;
    if (oscNode && audioCtx) {
      oscNode.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.01);
    }
    if (pitchValueLabel) {
      if (freq < 1000) {
        pitchValueLabel.textContent = Math.round(freq) + ' Hz';
      } else {
        pitchValueLabel.textContent = (freq / 1000).toFixed(2) + ' kHz';
      }
    }
  }

  function setPitchSliderFromFrequency(freq) {
    if (!pitchSlider || !Number.isFinite(freq) || freq <= 0) return;
    // Invert the mapping used in updatePitchFromSlider.
    var ratio = freq / pitchBaseHz;
    var raw = (Math.log(ratio) / Math.log(2)) / pitchOctaves + 0.5;
    var clamped = Math.max(0, Math.min(1, raw));
    pitchSlider.value = String(clamped);
    // Update displayed label to match new slider position.
    updatePitchFromSlider();
  }

  function clearCanvas() {
    const ctx2d = scopeCanvas.getContext('2d');
    if (!ctx2d) return;
    const width = scopeCanvas.width;
    const height = scopeCanvas.height;
    ctx2d.setTransform(1, 0, 0, 1, 0, 0);
    ctx2d.clearRect(0, 0, width, height);
  }

  function resizeCanvas() {
    const rect = scopeCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    scopeCanvas.width = Math.max(1, Math.floor(rect.width * dpr));
    scopeCanvas.height = Math.max(1, Math.floor(rect.height * dpr));
  }

  function draw() {
    const ctx2d = scopeCanvas.getContext('2d');
    if (!ctx2d) return;

    const dpr = window.devicePixelRatio || 1;
    const width = scopeCanvas.width;
    const height = scopeCanvas.height;

    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, width, height);

    const logicalWidth = width / dpr;
    const logicalHeight = height / dpr;

    // Background
    ctx2d.fillStyle = '#050708';
    ctx2d.fillRect(0, 0, logicalWidth, logicalHeight);

    // If analyser is available, draw real audio data
    if (analyserNode) {
      const timeData = new Uint8Array(analyserNode.fftSize);
      const freqData = new Uint8Array(analyserNode.frequencyBinCount);

      analyserNode.getByteTimeDomainData(timeData);
      analyserNode.getByteFrequencyData(freqData);

      // Draw simple harmonic bars first (so waveform sits on top)
      const bars = 40;
      const barWidth = logicalWidth / bars;
      const baseY = logicalHeight * 0.95;
      ctx2d.fillStyle = 'rgba(192,107,166,0.85)';
      for (let i = 0; i < bars; i++) {
        const index = Math.floor((i / bars) * freqData.length);
        const value = freqData[index] / 255;
        const barHeight = value * (logicalHeight * 0.55);
        const bx = i * barWidth;
        const by = baseY - barHeight;
        ctx2d.fillRect(bx, by, barWidth * 0.8, barHeight);
      }

      // Draw waveform centered vertically
      ctx2d.lineWidth = 1.4;
      ctx2d.strokeStyle = 'rgba(106,169,189,0.98)';
      ctx2d.beginPath();
      const sliceWidth = logicalWidth / timeData.length;
      let x = 0;
      const centerY = logicalHeight * 0.5;
      const amplitude = logicalHeight * 1.5;
      for (let i = 0; i < timeData.length; i++) {
        const v = timeData[i] / 128.0 - 1.0;
        const y = centerY + v * amplitude;
        if (i === 0) {
          ctx2d.moveTo(x, y);
        } else {
          ctx2d.lineTo(x, y);
        }
        x += sliceWidth;
      }
      ctx2d.stroke();
    } else {
      // No real audio yet - draw synthetic waveform based on current settings
      simulatedTime += 0.016; // ~60fps
      
      // Get current pitch from slider
      const pitchRaw = pitchSlider ? parseFloat(pitchSlider.value) : 0.5;
      const pitchFactor = Math.pow(2, pitchOctaves * (pitchRaw - 0.5));
      const freq = pitchBaseHz * pitchFactor;
      
      // Generate synthetic waveform
      const samples = 512;
      const syntheticTimeData = new Float32Array(samples);
      const syntheticFreqData = new Float32Array(40);
      
      for (let i = 0; i < samples; i++) {
        const t = simulatedTime + (i / samples) * (4 / freq); // Show ~4 cycles
        const phase = t * freq * Math.PI * 2;
        let value = 0;
        
        if (currentWave === 'sine') {
          value = Math.sin(phase);
        } else if (currentWave === 'square') {
          value = Math.sin(phase) > 0 ? 0.8 : -0.8;
        } else if (currentWave === 'sawtooth') {
          value = ((phase % (Math.PI * 2)) / Math.PI) - 1;
        }
        
        syntheticTimeData[i] = value;
      }
      
      // Generate synthetic frequency bars based on waveform type
      for (let i = 0; i < 40; i++) {
        if (currentWave === 'sine') {
          // Sine has only fundamental
          syntheticFreqData[i] = i < 3 ? 0.8 - i * 0.3 : 0;
        } else if (currentWave === 'square') {
          // Square has odd harmonics
          if (i % 2 === 0 && i < 20) {
            syntheticFreqData[i] = 0.7 / (i + 1);
          }
        } else if (currentWave === 'sawtooth') {
          // Sawtooth has all harmonics
          syntheticFreqData[i] = i < 25 ? 0.6 / (i + 1) : 0;
        }
      }
      
      // Draw synthetic harmonic bars
      const bars = 40;
      const barWidth = logicalWidth / bars;
      const baseY = logicalHeight * 0.95;
      ctx2d.fillStyle = 'rgba(192,107,166,0.85)';
      for (let i = 0; i < bars; i++) {
        const value = syntheticFreqData[i];
        const barHeight = value * (logicalHeight * 0.55);
        const bx = i * barWidth;
        const by = baseY - barHeight;
        ctx2d.fillRect(bx, by, barWidth * 0.8, barHeight);
      }
      
      // Draw synthetic waveform
      ctx2d.lineWidth = 1.4;
      ctx2d.strokeStyle = 'rgba(106,169,189,0.98)';
      ctx2d.beginPath();
      const sliceWidth = logicalWidth / samples;
      let x = 0;
      const centerY = logicalHeight * 0.5;
      const amplitude = logicalHeight * 0.35;
      for (let i = 0; i < samples; i++) {
        const v = syntheticTimeData[i];
        const y = centerY + v * amplitude;
        if (i === 0) {
          ctx2d.moveTo(x, y);
        } else {
          ctx2d.lineTo(x, y);
        }
        x += sliceWidth;
      }
      ctx2d.stroke();
    }

    // Update LFO indicator pulse based on LFO frequency and audio context time.
    if (lfoIndicator) {
      if (lfoFrequency <= 0) {
        lfoIndicator.style.transform = 'scale(0.7)';
        lfoIndicator.style.boxShadow = '0 0 3px rgba(255,77,77,0.35)';
        lfoIndicator.style.opacity = '0.4';
      } else {
        const t = audioCtx ? audioCtx.currentTime : (Date.now() / 1000);
        const phase = t * lfoFrequency * Math.PI * 2;
        const intensity = (Math.sin(phase) + 1) / 2; // 0..1
        const scale = 0.75 + intensity * 0.5;
        const alpha = 0.3 + intensity * 0.6;
        lfoIndicator.style.transform = 'scale(' + scale.toFixed(2) + ')';
        lfoIndicator.style.boxShadow =
          '0 0 ' + (4 + 8 * intensity).toFixed(1) + 'px rgba(255,77,77,' + alpha.toFixed(2) + ')';
        lfoIndicator.style.opacity = (0.5 + 0.5 * intensity).toFixed(2);
      }
    }

    animationFrameId = requestAnimationFrame(draw);
  }

  let synthStarted = false;

  function startSynth() {
    if (synthStarted) return;
    
    const ctx = ensureAudioContext();
    if (ctx.state === 'suspended') {
      // Can't start yet, will be called again after resume
      return;
    }
    
    // Create audio graph if needed
    if (!filterNode || !gainNode || !analyserNode) {
      createGraph();
    }
    
    // Create and start oscillator
    if (oscNode) {
      try { oscNode.stop(); } catch (_e) {}
      oscNode.disconnect();
    }
    oscNode = ctx.createOscillator();
    oscNode.type = currentWave;
    oscNode.connect(filterNode);
    updatePitchFromSlider();
    oscNode.start();
    
    updateFilterFromSlider();
    
    synthStarted = true;
  }

  function ensureSynthRunning() {
    const ctx = ensureAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().then(function() {
        startSynth();
      });
    } else {
      startSynth();
    }
  }

  waveButtons.forEach(function(btn) {
    btn.addEventListener('click', function() {
      const wave = btn.getAttribute('data-wave') || 'sine';
      setWaveform(wave);
      ensureSynthRunning();
    });
  });

  filterSlider.addEventListener('input', function() {
    ensureSynthRunning();
    updateFilterFromSlider();
    updateKnobIndicator(filterSlider);
  });

  if (pitchSlider) {
    pitchSlider.addEventListener('input', function() {
      ensureSynthRunning();
      updatePitchFromSlider();
      updateKnobIndicator(pitchSlider);
    });
  }

  if (lfoSlider) {
    lfoSlider.addEventListener('input', function() {
      ensureSynthRunning();
      updateLfoFromSlider();
      updateKnobIndicator(lfoSlider);
    });
  }

  if (lfoDepthSlider) {
    lfoDepthSlider.addEventListener('input', function() {
      ensureSynthRunning();
      var raw = parseFloat(lfoDepthSlider.value);
      if (isNaN(raw)) {
        raw = 0.45;
      }
      lfoDepthFactor = raw;
      if (lfoDepthValueLabel) {
        lfoDepthValueLabel.textContent = Math.round(raw * 100) + '%';
      }
      updateLfoDepth();
      updateKnobIndicator(lfoDepthSlider);
    });
  }

  window.addEventListener('resize', function() {
    if (!scopeCanvas) return;
    resizeCanvas();
  });

  // Set up mute button
  const muteButton = document.getElementById('synthMuteButton');
  if (muteButton) {
    muteButton.addEventListener('click', toggleMute);
    updateMuteButton();
  }

  // Initialize UI to a sensible default.
  setWaveform(currentWave);
  updateFilterFromSlider();
  updatePitchFromSlider();
  initAllKnobIndicators();
  resizeCanvas();
  clearCanvas();
  
  // Start the draw loop immediately (shows flat line until audio starts)
  animationFrameId = requestAnimationFrame(draw);
  
  // Try to start the synth - will only work if context is not suspended
  // (most browsers require user interaction first)
  startSynth();
})();


