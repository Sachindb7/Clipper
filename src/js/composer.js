/**
 * composer.js — Canvas composition engine for 9:16 vertical shorts
 * Renders: blurred BG + centered video + hook text + CapCut captions + logo
 */

export class Composer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ width?: number, height?: number, logoImage?: HTMLImageElement }} options
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = options.width || 1080;
    this.height = options.height || 1920;
    this.logoImage = options.logoImage || null;

    canvas.width = this.width;
    canvas.height = this.height;

    this.animFrameId = null;
    this.isPreviewPlaying = false;

    // Layout calculations
    this.videoWidth = this.width;
    this.videoHeight = Math.round(this.width * 9 / 16); // 16:9 in 9:16 canvas
    this.videoY = Math.round((this.height - this.videoHeight) / 2) - 60; // Slightly above center

    // Font sizes scale with resolution
    const scale = this.width / 1080;
    this.hookFontSize = Math.round(52 * scale);
    this.captionFontSize = Math.round(56 * scale);
    this.captionHighlightSize = Math.round(62 * scale);

    // Offscreen canvas for blur
    this.blurCanvas = document.createElement('canvas');
    this.blurCanvas.width = this.width;
    this.blurCanvas.height = this.height;
    this.blurCtx = this.blurCanvas.getContext('2d');
  }

  /**
   * Render a single frame of the composition
   * @param {HTMLVideoElement} videoElement
   * @param {number} currentTime - Current playback time in seconds
   * @param {{ hook_text: string, start_time: number, end_time: number }} clip
   * @param {Array<{ text: string, timestamp: [number, number] }>} wordChunks - All word chunks for this clip
   */
  renderFrame(videoElement, currentTime, clip, wordChunks) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // 1. Blurred background
    this._drawBlurredBackground(videoElement);

    // 2. Dark overlay on blur
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, w, h);

    // 3. Sharp centered video
    this._drawCenteredVideo(videoElement);

    // 4. Hook text at top
    if (clip.hook_text) {
      this._drawHookText(clip.hook_text);
    }

    // 5. CapCut-style captions
    if (wordChunks && wordChunks.length > 0) {
      this._drawCaptions(wordChunks, currentTime);
    }

    // 6. Logo at bottom
    if (this.logoImage) {
      this._drawLogo();
    }
  }

  _drawBlurredBackground(videoElement) {
    const ctx = this.blurCtx;
    const w = this.width;
    const h = this.height;

    // Scale video to cover entire canvas (crop to fill)
    const videoAspect = videoElement.videoWidth / videoElement.videoHeight;
    const canvasAspect = w / h;
    let drawW, drawH, drawX, drawY;

    if (videoAspect > canvasAspect) {
      drawH = h;
      drawW = h * videoAspect;
      drawX = (w - drawW) / 2;
      drawY = 0;
    } else {
      drawW = w;
      drawH = w / videoAspect;
      drawX = 0;
      drawY = (h - drawH) / 2;
    }

    ctx.filter = 'blur(25px) brightness(0.6)';
    ctx.drawImage(videoElement, drawX - 20, drawY - 20, drawW + 40, drawH + 40);
    ctx.filter = 'none';

    // Copy to main canvas
    this.ctx.drawImage(this.blurCanvas, 0, 0);
  }

  _drawCenteredVideo(videoElement) {
    const ctx = this.ctx;

    // Subtle shadow behind video
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 8;

    ctx.drawImage(
      videoElement,
      0, this.videoY,
      this.videoWidth, this.videoHeight
    );

    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Thin border on video
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, this.videoY, this.videoWidth, this.videoHeight);
  }

  _drawHookText(text) {
    const ctx = this.ctx;
    const w = this.width;
    const y = this.videoY - 40;
    const maxWidth = w - 80;

    ctx.save();
    ctx.font = `800 ${this.hookFontSize}px Montserrat, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    // Background pill
    const metrics = ctx.measureText(text);
    const textW = Math.min(metrics.width, maxWidth);
    const pillPad = 16;
    const pillH = this.hookFontSize + pillPad * 2;
    const pillW = textW + pillPad * 3;
    const pillX = (w - pillW) / 2;
    const pillY = y - this.hookFontSize - pillPad;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this._roundRect(pillX, pillY, pillW, pillH, 12);
    ctx.fill();

    // Text with outline
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, w / 2, y, maxWidth);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, w / 2, y, maxWidth);

    ctx.restore();
  }

  _drawCaptions(wordChunks, currentTime) {
    const ctx = this.ctx;
    const w = this.width;
    const y = this.videoY + this.videoHeight - 80;

    // Find current word index
    let currentWordIdx = -1;
    for (let i = 0; i < wordChunks.length; i++) {
      const [start, end] = wordChunks[i].timestamp;
      if (currentTime >= start && currentTime <= end + 0.1) {
        currentWordIdx = i;
        break;
      }
    }

    // If between words, find the nearest upcoming word
    if (currentWordIdx === -1) {
      for (let i = 0; i < wordChunks.length; i++) {
        if (wordChunks[i].timestamp[0] > currentTime) {
          currentWordIdx = Math.max(0, i - 1);
          break;
        }
      }
    }

    if (currentWordIdx === -1) return;

    // Group words into fixed chunks of 4 so the text doesn't slide awkwardly
    const groupSize = 4;
    const groupIndex = Math.floor(currentWordIdx / groupSize);
    const windowStart = groupIndex * groupSize;
    const windowEnd = Math.min(wordChunks.length - 1, windowStart + groupSize - 1);

    // Gather words for this window
    const visibleWords = [];
    for (let i = windowStart; i <= windowEnd; i++) {
      visibleWords.push({
        text: wordChunks[i].text.trim(),
        isCurrent: i === currentWordIdx,
      });
    }

    if (visibleWords.length === 0) return;

    ctx.save();

    // Use ONE font for all measurement to avoid size mismatch
    const font = `800 ${this.captionFontSize}px Montserrat, sans-serif`;
    ctx.font = font;
    ctx.textBaseline = 'middle';

    // Fixed space between words
    const wordGap = Math.round(this.captionFontSize * 0.4);

    // Measure each word width individually (without trailing space)
    const segments = [];
    let totalWidth = 0;
    for (let i = 0; i < visibleWords.length; i++) {
      const wordWidth = ctx.measureText(visibleWords[i].text).width;
      segments.push({
        text: visibleWords[i].text,
        width: wordWidth,
        isCurrent: visibleWords[i].isCurrent,
      });
      totalWidth += wordWidth;
      if (i < visibleWords.length - 1) {
        totalWidth += wordGap; // Add gap between words (not after last)
      }
    }

    // Scale down if too wide
    const maxWidth = w - 80;
    const scale = totalWidth > maxWidth ? maxWidth / totalWidth : 1;
    const scaledTotal = totalWidth * scale;
    const scaledGap = wordGap * scale;

    // Background pill
    const pillPad = 16;
    const pillW = scaledTotal + pillPad * 2;
    const pillH = this.captionFontSize + pillPad * 2.5;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this._roundRect((w - pillW) / 2, y - pillH / 2, pillW, pillH, 14);
    ctx.fill();

    // Draw words left-to-right
    let x = (w - scaledTotal) / 2;
    ctx.font = font;
    ctx.textAlign = 'left';

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segW = seg.width * scale;

      // Outline (always black)
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
      ctx.lineWidth = 6;
      ctx.lineJoin = 'round';
      ctx.strokeText(seg.text, x, y);

      // Fill color — highlight current word
      if (seg.isCurrent) {
        ctx.fillStyle = '#FFD700';
      } else {
        ctx.fillStyle = '#FFFFFF';
      }
      ctx.fillText(seg.text, x, y);

      // Advance x by word width + gap
      x += segW;
      if (i < segments.length - 1) {
        x += scaledGap;
      }
    }

    ctx.restore();
  }

  _drawLogo() {
    const ctx = this.ctx;
    const w = this.width;
    const logo = this.logoImage;

    // Full width banner, maintaining aspect ratio
    const logoW = w;
    const logoH = Math.round(logoW * (logo.naturalHeight / logo.naturalWidth));
    const logoX = 0;
    const logoY = this.videoY + this.videoHeight; // Sticked right below the video

    ctx.globalAlpha = 1;
    ctx.drawImage(logo, logoX, logoY, logoW, logoH);
  }

  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /**
   * Start real-time preview playback on this canvas
   * @param {HTMLVideoElement} videoElement
   * @param {{ hook_text: string, start_time: number, end_time: number }} clip
   * @param {Array} wordChunks
   */
  startPreview(videoElement, clip, wordChunks) {
    this.stopPreview();
    this.isPreviewPlaying = true;

    // Set video to clip start
    videoElement.currentTime = clip.start_time;

    const render = () => {
      if (!this.isPreviewPlaying) return;

      const currentTime = videoElement.currentTime;

      // Stop at clip end
      if (currentTime >= clip.end_time) {
        videoElement.pause();
        this.isPreviewPlaying = false;
        return;
      }

      this.renderFrame(videoElement, currentTime, clip, wordChunks);
      this.animFrameId = requestAnimationFrame(render);
    };

    videoElement.play().then(() => {
      this.animFrameId = requestAnimationFrame(render);
    }).catch((err) => {
      console.error('Preview playback error:', err);
    });
  }

  /**
   * Stop preview playback
   */
  stopPreview() {
    this.isPreviewPlaying = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  /**
   * Render a single static frame (for thumbnails)
   * @param {HTMLVideoElement} videoElement
   * @param {{ hook_text: string }} clip
   * @param {Array} wordChunks
   * @param {number} time
   */
  renderStaticFrame(videoElement, clip, wordChunks, time) {
    return new Promise((resolve) => {
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        try {
          this.renderFrame(videoElement, time, clip, wordChunks);
        } catch (err) {
          console.warn('renderFrame error:', err);
        }
        resolve();
      };

      // If already at the right time, render immediately
      if (Math.abs(videoElement.currentTime - time) < 0.1 && videoElement.readyState >= 2) {
        done();
        return;
      }

      const onSeeked = () => {
        videoElement.removeEventListener('seeked', onSeeked);
        done();
      };
      videoElement.addEventListener('seeked', onSeeked);
      videoElement.currentTime = time;

      // Timeout fallback — if seeked never fires, render anyway after 2s
      setTimeout(done, 2000);
    });
  }
}
