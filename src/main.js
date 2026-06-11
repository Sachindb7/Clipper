/**
 * main.js — Clipper App Orchestrator
 * Ties together: upload → transcribe → Gemini analyze → preview → export
 */
import './styles/index.css';
import { initUpload } from './js/upload.js';
import { transcribeVideo } from './js/transcriber.js';
import { analyzeTranscript } from './js/gemini-analyzer.js';
import { splitTranscript } from './js/splitter.js';
import { Composer } from './js/composer.js';
import { exportClip, downloadBlob } from './js/exporter.js';
import defaultLogoUrl from './assets/default-logo.png';

// ============ State ============
const state = {
  videoFile: null,
  videoUrl: null,
  videoDuration: 0,
  transcript: null,
  clips: [],
  composers: [],
  videoElements: [],
  resolution: 1080, // 1080 or 720
  apiKey: localStorage.getItem('clipper_gemini_key') || '',
  logoImage: null,
  noLogo: false,
  hookStyle: 'single', // 'single', 'multi', 'both'
  language: 'en', // 'en', 'hi', 'hinglish'
};

// ============ DOM refs ============
const $ = (id) => document.getElementById(id);

const els = {
  apiKeyInput: $('api-key-input'),
  toggleKeyBtn: $('toggle-key-visibility'),
  resToggle: $('resolution-toggle'),
  processingSection: $('processing-section'),
  previewSection: $('preview-section'),
  clipsGrid: $('clips-grid'),
  exportAllBtn: $('export-all-btn'),
  exportModal: $('export-modal'),
  exportProgressList: $('export-progress-list'),
  exportOverall: $('export-overall'),
  statusLog: $('status-log'),
};

// ============ Init ============
function init() {
  // Restore API key
  if (state.apiKey) {
    els.apiKeyInput.value = state.apiKey;
  }

  // API key save
  els.apiKeyInput.addEventListener('input', (e) => {
    state.apiKey = e.target.value.trim();
    localStorage.setItem('clipper_gemini_key', state.apiKey);
  });

  // Toggle key visibility
  els.toggleKeyBtn.addEventListener('click', () => {
    const input = els.apiKeyInput;
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Resolution toggle
  els.resToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.res-btn');
    if (!btn) return;
    els.resToggle.querySelectorAll('.res-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.resolution = parseInt(btn.dataset.res);
  });

  // Load default logo
  loadLogo();

  // Logo upload
  const logoInput = $('logo-input');
  const changeLogoBtn = $('change-logo-btn');
  const logoStatus = $('logo-status');
  const noLogoBtn = $('no-logo-btn');

  if (changeLogoBtn && logoInput) {
    changeLogoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      logoInput.click();
    });
    logoInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          state.logoImage = img;
          state.noLogo = false;
          if (noLogoBtn) noLogoBtn.classList.remove('active');
          if (logoStatus) {
            logoStatus.textContent = '✅ ' + file.name;
            logoStatus.classList.add('loaded');
          }
          if (state.clips.length > 0) {
            buildPreviews();
          }
        };
        img.onerror = () => {
          alert('Could not load this image. Please try a PNG or JPG.');
        };
        img.src = url;
      }
    });
  }

  // No Logo toggle
  if (noLogoBtn) {
    noLogoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      state.noLogo = !state.noLogo;
      noLogoBtn.classList.toggle('active', state.noLogo);
      if (state.noLogo) {
        state.logoImage = null;
        if (logoStatus) {
          logoStatus.textContent = '🚫 Logo disabled';
          logoStatus.classList.remove('loaded');
        }
      } else {
        // Re-load default logo
        loadLogo();
        if (logoStatus) {
          logoStatus.textContent = 'No logo set (optional)';
          logoStatus.classList.remove('loaded');
        }
      }
      if (state.clips.length > 0) {
        buildPreviews();
      }
    });
  }

  // Hook Style toggle
  const hookToggle = $('hook-style-toggle');
  if (hookToggle) {
    hookToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.hook-btn');
      if (!btn) return;
      hookToggle.querySelectorAll('.hook-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.hookStyle = btn.dataset.hook;
    });
  }

  // Language toggle
  const langToggle = $('language-toggle');
  if (langToggle) {
    langToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.hook-btn');
      if (!btn) return;
      langToggle.querySelectorAll('.hook-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.language = btn.dataset.lang;
    });
  }

  // Init upload
  initUpload(onVideoSelected);

  // Export all
  els.exportAllBtn.addEventListener('click', exportAll);
}

async function loadLogo() {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = defaultLogoUrl; // Vite-resolved asset path
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    state.logoImage = img;
  } catch {
    console.warn('Could not load default logo — user can set one manually');
  }
}

// ============ Pipeline ============

async function onVideoSelected({ file, duration }) {
  state.videoFile = file;
  state.videoDuration = duration;
  state.videoUrl = URL.createObjectURL(file);

  // Show processing section
  els.processingSection.classList.remove('hidden');
  els.previewSection.classList.add('hidden');

  clearLog();
  log('📤 Video loaded: ' + file.name, 'info');

  try {
    // Step 1: Transcribe
    activateStep('transcribe');
    log('🎙️ Starting transcription with Whisper AI...');
    state.transcript = await transcribeVideo(file, (stage, percent, msg) => {
      setStepProgress('transcribe', percent);
      setStepStatus('transcribe', msg);
      log(`   ${msg}`);
    }, state.language);
    completeStep('transcribe');
    log(`✅ Transcription complete: ${state.transcript.chunks.length} words detected`, 'success');

    // Step 2: Analyze with Gemini
    activateStep('analyze');
    if (state.apiKey) {
      log('🤖 Sending transcript to AI for viral detection...');
      setStepStatus('analyze', 'Analyzing with AI...');
      setStepProgress('analyze', 30);

      const geminiClips = await analyzeTranscript(state.transcript, state.apiKey, (msg) => {
        log(`   ${msg}`);
        setStepStatus('analyze', msg);
      }, state.hookStyle);

      if (geminiClips && geminiClips.length > 0) {
        state.clips = geminiClips;
        log(`✅ Gemini found ${geminiClips.length} viral moments!`, 'success');

        // If Gemini returned fewer than 3, supplement with splitter clips
        if (geminiClips.length < 3) {
          log('📋 Supplementing with splitter clips to reach minimum 3...', 'info');
          const splitterClips = splitTranscript(state.transcript.chunks, state.videoDuration, 5);
          // Add splitter clips that don't overlap with Gemini clips
          for (const sc of splitterClips) {
            const overlaps = state.clips.some(gc =>
              (sc.start_time < gc.end_time && sc.end_time > gc.start_time)
            );
            if (!overlaps) {
              state.clips.push(sc);
            }
            if (state.clips.length >= 4) break;
          }
          state.clips.sort((a, b) => a.start_time - b.start_time);
          log(`📋 Total clips after supplementing: ${state.clips.length}`, 'info');
        }
        setStepProgress('analyze', 100);
      } else {
        log('⚠️ Gemini returned no results, using fallback splitter...', 'info');
        state.clips = splitTranscript(state.transcript.chunks, state.videoDuration);
        log(`📋 Created ${state.clips.length} clips with fallback splitter`, 'info');
        setStepProgress('analyze', 100);
      }
    } else {
      log('⚠️ No Gemini API key — using fallback splitter...', 'info');
      state.clips = splitTranscript(state.transcript.chunks, state.videoDuration);
      log(`📋 Created ${state.clips.length} clips with fallback splitter`, 'info');
      setStepProgress('analyze', 100);
    }
    completeStep('analyze');

    // Step 3: Compose previews
    activateStep('compose');
    log('🎬 Generating preview compositions...');
    try {
      await buildPreviews();
    } catch (err) {
      console.error('Preview build error:', err);
      log(`⚠️ Preview generation had issues: ${err.message}`, 'info');
    }
    completeStep('compose');
    log('✅ Previews ready!', 'success');

    // Step 4: Ready
    activateStep('ready');
    completeStep('ready');
    setStepStatus('ready', 'All set!');
    log('🎉 Your shorts are ready! Preview and export below.', 'success');

    // Show preview section
    els.previewSection.classList.remove('hidden');
    els.previewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    console.error('Pipeline error:', err);
    log(`❌ Error: ${err.message}`, 'error');
    alert('Something went wrong: ' + err.message);
  }
}

// ============ Preview Builder ============

async function buildPreviews() {
  els.clipsGrid.innerHTML = '';
  state.composers = [];
  state.videoElements = [];

  const w = state.resolution === 1080 ? 1080 : 720;
  const h = state.resolution === 1080 ? 1920 : 1280;

  for (let i = 0; i < state.clips.length; i++) {
    const clip = state.clips[i];
    const clipDuration = clip.end_time - clip.start_time;

    setStepProgress('compose', Math.round(((i + 1) / state.clips.length) * 100));
    setStepStatus('compose', `Composing clip ${i + 1} / ${state.clips.length}`);

    // Get word chunks for this clip
    const wordChunks = getChunksForClip(clip);

    // Create video element for this clip
    const video = document.createElement('video');
    video.src = state.videoUrl;
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    await new Promise((resolve) => {
      video.onloadeddata = resolve;
      video.onerror = resolve;
    });

    state.videoElements.push(video);

    // Create clip card
    const card = createClipCard(i, clip, w, h, video, wordChunks);
    els.clipsGrid.appendChild(card);

    // Create composer and render static thumbnail
    const canvas = card.querySelector('canvas');
    const composer = new Composer(canvas, { width: w, height: h, logoImage: state.logoImage });
    state.composers.push(composer);

    // Render thumbnail at 30% into clip
    const thumbTime = clip.start_time + clipDuration * 0.3;
    await composer.renderStaticFrame(video, clip, wordChunks, thumbTime);
  }
}

function createClipCard(index, clip, w, h, videoElement, wordChunks) {
  const clipDuration = clip.end_time - clip.start_time;

  const card = document.createElement('div');
  card.className = 'clip-card fade-in';
  card.style.animationDelay = `${index * 0.1}s`;
  card.innerHTML = `
    <div class="clip-canvas-wrap">
      <canvas></canvas>
      <button class="clip-play-btn" data-clip-index="${index}" title="Play preview">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </button>
      <span class="clip-badge">Clip ${index + 1}</span>
      <span class="clip-duration-badge">${formatTime(clipDuration)}</span>
    </div>
    <div class="clip-info">
      <label class="clip-hook-label">Hook Text</label>
      <input class="clip-hook-input" type="text" value="${escapeHtml(clip.hook_text)}" data-clip-index="${index}" />
      ${clip.reason ? `
        <div class="clip-reason">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          <span>${escapeHtml(clip.reason)}</span>
        </div>
      ` : ''}
      <div class="clip-actions">
        <button class="btn-primary" data-export-index="${index}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export
        </button>
        <button class="btn-secondary" data-preview-index="${index}">
          ▶ Preview
        </button>
      </div>
    </div>
  `;

  // Hook text edit
  const hookInput = card.querySelector('.clip-hook-input');
  hookInput.addEventListener('change', (e) => {
    state.clips[index].hook_text = e.target.value;
  });

  // Play preview
  const playBtn = card.querySelector('.clip-play-btn');
  const previewBtn = card.querySelector('[data-preview-index]');

  const startPreview = () => {
    // Stop all other previews
    state.composers.forEach((c) => c.stopPreview());
    state.videoElements.forEach((v) => v.pause());

    const composer = state.composers[index];
    const chunks = getChunksForClip(clip);
    videoElement.muted = false;
    composer.startPreview(videoElement, clip, chunks);

    playBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
    playBtn.onclick = () => {
      composer.stopPreview();
      videoElement.pause();
      videoElement.muted = true;
      playBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
      playBtn.onclick = startPreview;
    };
  };

  playBtn.onclick = startPreview;
  previewBtn.addEventListener('click', startPreview);

  // Export single
  const exportBtn = card.querySelector('[data-export-index]');
  exportBtn.addEventListener('click', () => exportSingleClip(index));

  return card;
}

// ============ Export ============

async function exportSingleClip(index) {
  const clip = state.clips[index];
  const video = state.videoElements[index];
  const composer = state.composers[index];
  const wordChunks = getChunksForClip(clip);
  const w = state.resolution === 1080 ? 1080 : 720;
  const h = state.resolution === 1080 ? 1920 : 1280;

  // Stop any preview
  composer.stopPreview();
  video.pause();
  video.muted = true;

  try {
    const blob = await exportClip(
      video,
      state.videoFile,
      clip,
      wordChunks,
      composer,
      { width: w, height: h, fps: 30, bitrate: w === 1080 ? 5_000_000 : 3_000_000 },
      (percent, msg) => {
        log(`   Clip ${index + 1}: ${msg} (${percent}%)`);
      }
    );

    const filename = `clipper_short_${index + 1}.mp4`;
    downloadBlob(blob, filename);
    log(`✅ Downloaded: ${filename}`, 'success');
  } catch (err) {
    console.error('Export error:', err);
    log(`❌ Export failed for clip ${index + 1}: ${err.message}`, 'error');
    alert('Export failed: ' + err.message);
  }
}

async function exportAll() {
  if (state.clips.length === 0) return;

  els.exportModal.classList.remove('hidden');
  els.exportProgressList.innerHTML = '';
  els.exportOverall.textContent = 'Starting...';

  // Create progress items
  state.clips.forEach((_, i) => {
    const item = document.createElement('div');
    item.className = 'export-progress-item';
    item.id = `export-item-${i}`;
    item.innerHTML = `
      <span class="label">Clip ${i + 1}</span>
      <div class="progress-mini"><div class="progress-mini-fill" id="export-fill-${i}" style="width:0%"></div></div>
      <span class="status-icon" id="export-status-${i}">⏳</span>
    `;
    els.exportProgressList.appendChild(item);
  });

  const blobs = [];

  for (let i = 0; i < state.clips.length; i++) {
    const clip = state.clips[i];
    const video = state.videoElements[i];
    const composer = state.composers[i];
    const wordChunks = getChunksForClip(clip);
    const w = state.resolution === 1080 ? 1080 : 720;
    const h = state.resolution === 1080 ? 1920 : 1280;

    composer.stopPreview();
    video.pause();
    video.muted = true;

    els.exportOverall.textContent = `Exporting clip ${i + 1} of ${state.clips.length}...`;
    $(`export-status-${i}`).textContent = '🔄';

    try {
      const blob = await exportClip(
        video,
        state.videoFile,
        clip,
        wordChunks,
        composer,
        { width: w, height: h, fps: 30, bitrate: w === 1080 ? 5_000_000 : 3_000_000 },
        (percent, msg) => {
          const fill = $(`export-fill-${i}`);
          if (fill) fill.style.width = percent + '%';
        }
      );

      blobs.push({ blob, name: `clipper_short_${i + 1}.mp4` });
      $(`export-status-${i}`).textContent = '✅';
    } catch (err) {
      console.error(`Export failed for clip ${i + 1}:`, err);
      $(`export-status-${i}`).textContent = '❌';
    }
  }

  // Download all
  els.exportOverall.textContent = 'Downloads starting...';
  for (const { blob, name } of blobs) {
    downloadBlob(blob, name);
    await new Promise((r) => setTimeout(r, 500)); // Stagger downloads
  }

  els.exportOverall.textContent = `Done! ${blobs.length} clips exported.`;
  log(`🎉 Exported ${blobs.length} shorts!`, 'success');

  // Close modal after 3s
  setTimeout(() => {
    els.exportModal.classList.add('hidden');
  }, 3000);
}

// ============ Helpers ============

function getChunksForClip(clip) {
  if (!state.transcript || !state.transcript.chunks) return [];
  return state.transcript.chunks.filter((c) => {
    const wordStart = c.timestamp?.[0] ?? 0;
    const wordEnd = c.timestamp?.[1] ?? 0;
    return wordStart >= clip.start_time - 0.1 && wordEnd <= clip.end_time + 0.1;
  });
}

// ---- Pipeline UI helpers ----

function activateStep(stepName) {
  const el = $(`step-${stepName}`);
  if (el) {
    el.classList.add('active');
    el.classList.remove('completed');
  }
  // Activate connector before this step
  const steps = ['transcribe', 'analyze', 'compose', 'ready'];
  const idx = steps.indexOf(stepName);
  if (idx > 0) {
    const connectors = document.querySelectorAll('.pipeline-connector');
    if (connectors[idx - 1]) connectors[idx - 1].classList.add('active');
  }
}

function completeStep(stepName) {
  const el = $(`step-${stepName}`);
  if (el) {
    el.classList.remove('active');
    el.classList.add('completed');
  }
  setStepProgress(stepName, 100);
  setStepStatus(stepName, 'Done ✓');
}

function setStepProgress(stepName, percent) {
  const fill = $(`progress-${stepName}`);
  if (fill) fill.style.width = Math.min(100, percent) + '%';
}

function setStepStatus(stepName, text) {
  const el = $(`status-${stepName}`);
  if (el) el.textContent = text;
}

function log(message, type = '') {
  const p = document.createElement('p');
  p.className = 'log-line' + (type ? ` ${type}` : '');
  p.textContent = message;
  els.statusLog.appendChild(p);
  els.statusLog.scrollTop = els.statusLog.scrollHeight;
}

function clearLog() {
  els.statusLog.innerHTML = '';
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============ Boot ============
document.addEventListener('DOMContentLoaded', init);
