(function() {
  const synthRoot = document.querySelector('.synth');
  if (!synthRoot) return;

  const playButton = synthRoot.querySelector('[data-synth-play]');
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
  const envAttackSlider = /** @type {HTMLInputElement | null} */ (document.getElementById('synthEnvAttack'));
  const envAttackValueLabel = document.getElementById('synthEnvAttackValue');
  const envDecaySlider = /** @type {HTMLInputElement | null} */ (document.getElementById('synthEnvDecay'));
  const envDecayValueLabel = document.getElementById('synthEnvDecayValue');
  const envSustainSlider = /** @type {HTMLInputElement | null} */ (document.getElementById('synthEnvSustain'));
  const envSustainValueLabel = document.getElementById('synthEnvSustainValue');
  const envReleaseSlider = /** @type {HTMLInputElement | null} */ (document.getElementById('synthEnvRelease'));
  const envReleaseValueLabel = document.getElementById('synthEnvReleaseValue');
  const keyboardEl = document.getElementById('synthKeyboard');
  const keyboardKeys = keyboardEl ? Array.from(keyboardEl.querySelectorAll('.synth-key')) : [];
  const keyboardToggleButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('synthKeyboardToggle'));
  const scopeCanvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('synthScope'));
  const statusText = synthRoot.querySelector('[data-synth-status]');

  if (
    !playButton ||
    waveButtons.length === 0 ||
    !filterSlider ||
    !filterValueLabel ||
    !pitchSlider ||
    !pitchValueLabel ||
    !lfoSlider ||
    !lfoValueLabel ||
    !lfoDepthSlider ||
    !lfoDepthValueLabel ||
    !envAttackSlider ||
    !envAttackValueLabel ||
    !envDecaySlider ||
    !envDecayValueLabel ||
    !envSustainSlider ||
    !envSustainValueLabel ||
    !envReleaseSlider ||
    !envReleaseValueLabel ||
    !keyboardEl ||
    keyboardKeys.length === 0 ||
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
    playButton.disabled = true;
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
  /** @type {GainNode | null} */
  let envGainNode = null;

  /** @type {number | null} */
  let animationFrameId = null;
  let playing = false;
  let currentWave = 'sine';

  const minFreq = 100;
  const maxFreq = 20000;
  let lfoFrequency = 0.0;
  let baseCutoffHz = 0;
  let lfoDepthFactor = 0.45; // LFO depth as a fraction of the base cutoff
  const env = {
    attack: 0.02,
    decay: 0.12,
    sustain: 0.7,
    release: 0.25
  };
  let keyboardEnabled = true;

  /**
   * @returns {AudioContext}
   */
  function ensureAudioContext() {
    if (!audioCtx) {
      audioCtx = new AudioCtx();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function createGraph() {
    const ctx = ensureAudioContext();
    filterNode = ctx.createBiquadFilter();
    filterNode.type = 'lowpass';

    envGainNode = ctx.createGain();
    envGainNode.gain.value = 0.0;

    gainNode = ctx.createGain();
    gainNode.gain.value = 0.16;

    analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.7;

    envGainNode.connect(filterNode);
    filterNode.connect(gainNode);
    gainNode.connect(analyserNode);
    analyserNode.connect(ctx.destination);

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

  function updateEnvelopeFromSliders() {
    if (!audioCtx) return;
    // Attack: 0–1 -> 5–500 ms
    if (envAttackSlider) {
      var aRaw = parseFloat(envAttackSlider.value);
      if (isNaN(aRaw)) aRaw = 0.05;
      env.attack = 0.005 + aRaw * 0.495;
      if (envAttackValueLabel) {
        envAttackValueLabel.textContent = Math.round(env.attack * 1000) + ' ms';
      }
    }
    // Decay: 0–1 -> 20–800 ms
    if (envDecaySlider) {
      var dRaw = parseFloat(envDecaySlider.value);
      if (isNaN(dRaw)) dRaw = 0.2;
      env.decay = 0.02 + dRaw * 0.78;
      if (envDecayValueLabel) {
        envDecayValueLabel.textContent = Math.round(env.decay * 1000) + ' ms';
      }
    }
    // Sustain: 0–1 -> 0–1
    if (envSustainSlider) {
      var sRaw = parseFloat(envSustainSlider.value);
      if (isNaN(sRaw)) sRaw = 0.7;
      env.sustain = Math.max(0, Math.min(1, sRaw));
      if (envSustainValueLabel) {
        envSustainValueLabel.textContent = env.sustain.toFixed(2);
      }
    }
    // Release: 0–1 -> 40–1200 ms
    if (envReleaseSlider) {
      var rRaw = parseFloat(envReleaseSlider.value);
      if (isNaN(rRaw)) rRaw = 0.25;
      env.release = 0.04 + rRaw * 1.16;
      if (envReleaseValueLabel) {
        envReleaseValueLabel.textContent = Math.round(env.release * 1000) + ' ms';
      }
    }
  }

  function triggerEnvelopeOn(time) {
    if (!keyboardEnabled) {
      // When keyboard is bypassed, keep envelope fully open.
      if (envGainNode && audioCtx) {
        const t = typeof time === 'number' ? time : audioCtx.currentTime;
        envGainNode.gain.cancelScheduledValues(t);
        envGainNode.gain.setValueAtTime(1, t);
      }
      return;
    }
    if (!envGainNode || !audioCtx) return;
    const g = envGainNode.gain;
    const t = typeof time === 'number' ? time : audioCtx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(1, t + env.attack);
    g.linearRampToValueAtTime(env.sustain, t + env.attack + env.decay);
  }

  function triggerEnvelopeOff(time) {
    if (!keyboardEnabled) return;
    if (!envGainNode || !audioCtx) return;
    const g = envGainNode.gain;
    const t = typeof time === 'number' ? time : audioCtx.currentTime;
    g.cancelScheduledValues(t);
    const current = g.value;
    g.setValueAtTime(current, t);
    g.linearRampToValueAtTime(0, t + env.release);
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

  const pitchBaseHz = 220;
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

  function startOscillator() {
    const ctx = ensureAudioContext();
    if (!filterNode || !gainNode || !analyserNode) {
      createGraph();
    }
    if (!filterNode || !analyserNode) {
      return;
    }
    if (oscNode) {
      try {
        oscNode.stop();
      } catch (_e) {
        // ignore
      }
      oscNode.disconnect();
    }
    oscNode = ctx.createOscillator();
    oscNode.type = /** @type {OscillatorType} */ (currentWave);
    if (envGainNode) {
      oscNode.connect(envGainNode);
    } else if (filterNode) {
      // Fallback, should not normally happen.
      oscNode.connect(filterNode);
    }
    // Apply current pitch knob setting; falls back to 220 Hz if slider missing.
    updatePitchFromSlider();
    oscNode.start();
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
    if (!analyserNode) return;
    const ctx2d = scopeCanvas.getContext('2d');
    if (!ctx2d) return;

    const dpr = window.devicePixelRatio || 1;
    const width = scopeCanvas.width;
    const height = scopeCanvas.height;

    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, width, height);

    const logicalWidth = width / dpr;
    const logicalHeight = height / dpr;

    const timeData = new Uint8Array(analyserNode.fftSize);
    const freqData = new Uint8Array(analyserNode.frequencyBinCount);

    analyserNode.getByteTimeDomainData(timeData);
    analyserNode.getByteFrequencyData(freqData);

    // Background
    ctx2d.fillStyle = '#050708';
    ctx2d.fillRect(0, 0, logicalWidth, logicalHeight);

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
    const amplitude = logicalHeight*1.5;
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

    if (playing) {
      animationFrameId = window.requestAnimationFrame(draw);
    }
  }

  function start() {
    if (playing) return;
    startOscillator();
    updateFilterFromSlider();
    playing = true;
    playButton.textContent = 'Stop';
    playButton.setAttribute('data-state', 'playing');
    resizeCanvas();
    clearCanvas();
    animationFrameId = window.requestAnimationFrame(draw);
  }

  function stop() {
    if (!playing) return;
    playing = false;
    playButton.textContent = 'Play';
    playButton.removeAttribute('data-state');
    if (animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    if (oscNode) {
      try {
        oscNode.stop();
      } catch (_e) {
        // ignore
      }
      oscNode.disconnect();
      oscNode = null;
    }
    clearCanvas();
  }

  function noteOn(freq) {
    const ctx = ensureAudioContext();
    if (!playing) {
      start();
    }
    if (oscNode && ctx) {
      oscNode.frequency.setTargetAtTime(freq, ctx.currentTime, 0.01);
    }
    // Reflect keyboard-selected pitch on the pitch knob.
    setPitchSliderFromFrequency(freq);
    triggerEnvelopeOn();
  }

  function noteOff() {
    triggerEnvelopeOff();
  }

  playButton.addEventListener('click', function() {
    if (!playing) {
      start();
    } else {
      stop();
    }
  });

  waveButtons.forEach(function(btn) {
    btn.addEventListener('click', function() {
      const wave = btn.getAttribute('data-wave') || 'sine';
      setWaveform(wave);
      if (!playing) {
        // Lazily create context on first interaction.
        ensureAudioContext();
      }
    });
  });

  filterSlider.addEventListener('input', function() {
    if (!audioCtx) {
      ensureAudioContext();
    }
    updateFilterFromSlider();
  });

  if (pitchSlider) {
    pitchSlider.addEventListener('input', function() {
      if (!audioCtx) {
        ensureAudioContext();
      }
      updatePitchFromSlider();
    });
  }

  if (lfoSlider) {
    lfoSlider.addEventListener('input', function() {
      if (!audioCtx) {
        ensureAudioContext();
      }
      updateLfoFromSlider();
    });
  }

  if (lfoDepthSlider) {
    lfoDepthSlider.addEventListener('input', function() {
      if (!audioCtx) {
        ensureAudioContext();
      }
      var raw = parseFloat(lfoDepthSlider.value);
      if (isNaN(raw)) {
        raw = 0.45;
      }
      lfoDepthFactor = raw;
      if (lfoDepthValueLabel) {
        lfoDepthValueLabel.textContent = Math.round(raw * 100) + '%';
      }
      updateLfoDepth();
    });
  }

  if (envAttackSlider && envDecaySlider && envSustainSlider && envReleaseSlider) {
    const attachEnvListener = function(slider) {
      slider.addEventListener('input', function() {
        if (!audioCtx) {
          ensureAudioContext();
        }
        updateEnvelopeFromSliders();
      });
    };
    attachEnvListener(envAttackSlider);
    attachEnvListener(envDecaySlider);
    attachEnvListener(envSustainSlider);
    attachEnvListener(envReleaseSlider);
  }

  if (keyboardToggleButton) {
    keyboardToggleButton.addEventListener('click', function() {
      keyboardEnabled = !keyboardEnabled;
      if (keyboardToggleButton) {
        keyboardToggleButton.textContent = keyboardEnabled ? 'Keyboard: On' : 'Keyboard: Bypassed';
      }
      if (envGainNode && audioCtx) {
        const t = audioCtx.currentTime;
        envGainNode.gain.cancelScheduledValues(t);
        envGainNode.gain.setValueAtTime(keyboardEnabled ? 0 : 1, t);
      }
    });
  }

  if (keyboardKeys.length > 0) {
    keyboardKeys.forEach(function(keyEl) {
      const noteAttr = keyEl.getAttribute('data-note');
      const note = noteAttr ? parseInt(noteAttr, 10) : NaN;
      if (!Number.isFinite(note)) return;
      const freq = 440 * Math.pow(2, (note - 69) / 12);

      const press = function() {
        keyEl.classList.add('synth-key--active');
        noteOn(freq);
      };
      const release = function() {
        keyEl.classList.remove('synth-key--active');
        noteOff();
      };

      keyEl.addEventListener('mousedown', function(e) {
        e.preventDefault();
        press();
      });
      keyEl.addEventListener('mouseup', function() {
        release();
      });
      keyEl.addEventListener('mouseleave', function() {
        release();
      });
      keyEl.addEventListener('touchstart', function(e) {
        e.preventDefault();
        press();
      }, { passive: false });
      keyEl.addEventListener('touchend', function() {
        release();
      });
    });
  }

  window.addEventListener('resize', function() {
    if (!scopeCanvas) return;
    resizeCanvas();
  });

  // Initialize UI to a sensible default.
  setWaveform(currentWave);
  updateFilterFromSlider();
  updatePitchFromSlider();
  resizeCanvas();
  clearCanvas();
})();


