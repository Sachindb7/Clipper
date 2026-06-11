/**
 * upload.js — Video upload handler with drag-drop support
 */

/**
 * @param {Function} onFileSelected - Callback: ({ file, duration, width, height, thumbnail })
 */
export function initUpload(onFileSelected) {
  const zone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  const prompt = document.getElementById('upload-prompt');
  const preview = document.getElementById('upload-preview');
  const thumbCanvas = document.getElementById('video-thumbnail');
  const durationEl = document.getElementById('preview-duration');
  const filenameEl = document.getElementById('preview-filename');
  const metaEl = document.getElementById('preview-meta');
  const changeBtn = document.getElementById('change-video-btn');

  // Click to browse
  zone.addEventListener('click', (e) => {
    if (e.target === changeBtn || zone.classList.contains('has-file') && !e.target.closest('.btn-secondary')) return;
    if (!zone.classList.contains('has-file')) {
      fileInput.click();
    }
  });

  changeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    resetUpload();
    fileInput.click();
  });

  // File input change
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  // Drag and drop
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('dragover');
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  });

  function resetUpload() {
    zone.classList.remove('has-file');
    prompt.classList.remove('hidden');
    preview.classList.add('hidden');
    fileInput.value = '';
  }

  async function handleFile(file) {
    // Validate type
    const validTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(mp4|webm|mov|avi)$/i)) {
      alert('Please select a valid video file (MP4, WebM, MOV)');
      return;
    }

    // Validate size (max 500MB)
    if (file.size > 500 * 1024 * 1024) {
      alert('File too large. Max 500MB.');
      return;
    }

    try {
      const metadata = await extractMetadata(file);

      // Validate duration
      if (metadata.duration < 10) {
        alert('Video too short. Minimum 10 seconds.');
        return;
      }
      if (metadata.duration > 300) {
        alert('Video too long. Maximum 5 minutes.');
        return;
      }

      // Update UI
      zone.classList.add('has-file');
      prompt.classList.add('hidden');
      preview.classList.remove('hidden');

      filenameEl.textContent = file.name;
      durationEl.textContent = formatDuration(metadata.duration);
      metaEl.textContent = `${metadata.width}×${metadata.height} • ${formatDuration(metadata.duration)}`;

      // Draw thumbnail
      const ctx = thumbCanvas.getContext('2d');
      ctx.drawImage(metadata.thumbnail, 0, 0, thumbCanvas.width, thumbCanvas.height);

      onFileSelected({
        file,
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
      });
    } catch (err) {
      console.error('Error processing video:', err);
      alert('Could not read video file. Please try another.');
    }
  }

  function extractMetadata(file) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;

      const url = URL.createObjectURL(file);
      video.src = url;

      video.onloadedmetadata = () => {
        // Seek to 25% for thumbnail
        video.currentTime = video.duration * 0.25;
      };

      video.onseeked = () => {
        // Create thumbnail
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);

        resolve({
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          thumbnail: canvas,
        });

        URL.revokeObjectURL(url);
      };

      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load video'));
      };
    });
  }
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
