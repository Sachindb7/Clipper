# ✂️ Clipper — AI Video to Shorts Generator

Turn long videos into viral shorts — powered by AI. 100% client-side.

![Clipper](https://img.shields.io/badge/Status-Beta-blueviolet) ![License](https://img.shields.io/badge/License-MIT-green)

## 🚀 Features

- **🎙️ Whisper AI Transcription** — Automatic word-level captions using Whisper (runs in browser via transformers.js)
- **🤖 Gemini 2.5 Flash Analysis** — AI detects the most viral-worthy moments and generates scroll-stopping hooks with emojis
- **🎬 9:16 Vertical Composition** — Blurred background + centered video + CapCut-style captions + custom logo banner
- **📦 WebCodecs MP4 Export** — High-quality H.264 video export with audio, directly in the browser
- **🔒 100% Client-Side** — Your videos never leave your device (except the Gemini API call for transcript analysis)
- **🖼️ Custom Logo Banner** — Upload your own branding banner that sits right below the video

## 🛠️ Tech Stack

| Technology | Purpose |
|-----------|---------|
| [Vite](https://vitejs.dev/) | Build tool & dev server |
| [Transformers.js](https://huggingface.co/docs/transformers.js) | Whisper speech-to-text in browser |
| [FFmpeg.wasm](https://ffmpegwasm.netlify.app/) | Audio extraction |
| [WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) | H.264 video encoding |
| [mp4-muxer](https://github.com/nicke08/mp4-muxer) | MP4 container muxing |
| [Gemini 2.5 Flash](https://ai.google.dev/) | Viral moment detection (BYOK) |

## 📋 Requirements

- **Browser**: Chrome 94+ or Edge 94+ (WebCodecs required)
- **Gemini API Key**: Free tier from [Google AI Studio](https://aistudio.google.com/apikey) (optional, enables AI clip detection)

## 🏃 Getting Started

```bash
# Clone the repo
git clone https://github.com/Sachindb7/Clipper.git
cd Clipper

# Install dependencies
npm install

# Start dev server
npm run dev
```

Open **http://localhost:5173/** in Chrome.

## 📖 How to Use

1. **Enter Gemini API Key** (optional) — in the top settings bar
2. **Upload a video** — drag & drop or click (MP4/WebM/MOV, 16:9, max 5 min)
3. **Set Logo Banner** (optional) — upload your branding image
4. **Wait for processing** — Whisper transcribes → Gemini finds viral moments → Previews generate
5. **Preview & Edit** — watch each short, edit hook text
6. **Export** — download individual clips or export all as MP4

## 📁 Project Structure

```
Clipper/
├── index.html                  # Main HTML
├── vite.config.js              # Vite config with COOP/COEP headers
├── public/
│   └── coi-serviceworker.js    # Cross-origin isolation for SharedArrayBuffer
├── src/
│   ├── main.js                 # App orchestrator
│   ├── styles/
│   │   └── index.css           # Premium dark design system
│   ├── assets/
│   │   └── default-logo.png    # Default branding
│   └── js/
│       ├── upload.js           # Drag-drop video upload
│       ├── transcriber.js      # Whisper transcription
│       ├── audio-extractor.js  # FFmpeg audio extraction
│       ├── gemini-analyzer.js  # Gemini viral detection
│       ├── splitter.js         # Fallback clip splitter
│       ├── composer.js         # Canvas 9:16 composition
│       └── exporter.js         # WebCodecs MP4 export
```

## 📝 License

MIT
