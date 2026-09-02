# 🎙️ Voice Notes → Action Items

A modern, full-stack, **100% offline & local** web application that converts voice notes or meeting recordings into structured action items (**Task**, **Owner**, and **Deadline**).

Everything runs locally on your machine — **no paid cloud APIs, no subscriptions, no tracking**.

---

## 🌟 Features

- **Local Speech-to-Text (`faster-whisper`)**: Transcribes `.mp3`, `.wav`, `.m4a`, `.webm`, and `.ogg` files directly on your CPU/GPU without external network calls.
- **Local LLM Action Item Extraction (`Ollama`)**: Calls locally-hosted models (`llama3.2`, `llama3.1:8b`, or `phi3`) to parse the transcript and extract tasks into structured JSON.
- **Dual Audio Input**:
  - Drag-and-drop audio file upload.
  - In-browser live microphone recorder with timer, waveform feedback, and audio preview.
- **Model Size Selector**: Choose between `tiny` (fastest), `base` (recommended default), or `small` (higher accuracy).
- **Export & Productivity**:
  - One-click copy raw transcript.
  - "Copy as Text" formatted action items list.
  - "Export as Markdown" downloadable table.
  - Local history drawer remembering recent recordings across page refreshes.
- **Defensive LLM Response Parsing**: Handles model code fences, markdown wrapping, and malformed outputs smoothly.

---

## 📁 Project Architecture

```
voice-notes-action-items/
├── backend/
│   ├── main.py              # FastAPI server: /process-audio, /health, whisper & ollama
│   ├── requirements.txt     # Python backend dependencies
│   ├── .env.example         # Backend environment variables
│   └── venv/                # Python virtual environment
├── frontend/
│   ├── app/
│   │   ├── page.js          # Next.js App Router main interactive UI
│   │   ├── layout.js        # Root layout with SEO and fonts
│   │   └── globals.css      # Tailwind styling and glassmorphism
│   ├── package.json         # Frontend dependencies
│   ├── .env.example         # Frontend environment template
│   └── .env.local           # Local runtime frontend configuration
└── README.md                # Full setup & step-by-step running guide
```

---

## 🚀 Quick Start Guide (Step-by-Step)

Follow these steps in order:

### Step 1: Install Ollama & Pull a Model

1. Download and install **Ollama** from [https://ollama.com/download](https://ollama.com/download).
2. Open your terminal and start Ollama (if not running automatically in the system tray):
   ```bash
   ollama serve
   ```
3. In a terminal window, pull your chosen model (recommended: `llama3.2` for balanced speed & quality):
   ```bash
   ollama pull llama3.2
   ```
   *(Alternative models: `llama3.1:8b` or `phi3` if you have limited RAM).*
4. Verify Ollama is responding:
   ```bash
   curl http://localhost:11434
   # Should return: "Ollama is running"
   ```

---

### Step 2: Start the Backend (FastAPI)

1. Open a new terminal and navigate to the backend directory:
   ```powershell
   cd voice-notes-action-items\backend
   ```
2. Activate the pre-configured Python virtual environment (or create one using Python 3.11):
   ```powershell
   # Activate existing venv:
   .\venv\Scripts\Activate.ps1

   # (If creating from scratch on a new machine:)
   # py -3.11 -m venv venv
   # .\venv\Scripts\Activate.ps1
   # pip install -r requirements.txt
   ```
3. Start the FastAPI server on port `8000`:
   ```powershell
   uvicorn main:app --reload --port 8000
   ```
4. Verify the backend is running by opening:
   - Interactive API Docs: [http://localhost:8000/docs](http://localhost:8000/docs)
   - Health check: [http://localhost:8000/health](http://localhost:8000/health)

---

### Step 3: Start the Frontend (Next.js)

1. Open another terminal and navigate to the frontend directory:
   ```powershell
   cd voice-notes-action-items\frontend
   ```
2. Install npm dependencies (if running for the first time):
   ```powershell
   npm install
   ```
3. Start the Next.js development server:
   ```powershell
   npm run dev -- --port 3000
   ```
4. Open your browser and navigate to:
   [http://localhost:3000](http://localhost:3000)

---

## 🔌 API Endpoints

### `GET /health`
Returns the status of the FastAPI backend, loaded Faster-Whisper models, and Ollama connection status.
```json
{
  "status": "healthy",
  "ollama": {
    "online": true,
    "url": "http://localhost:11434",
    "selected_model": "llama3.2",
    "available_models": ["llama3.2:latest"]
  },
  "whisper": {
    "default_model": "base",
    "loaded_models": ["base"]
  }
}
```

### `POST /process-audio?whisper_model=base`
Accepts a multipart audio file upload (`file: UploadFile`).
- Supports `.mp3`, `.wav`, `.m4a`, `.webm`, `.ogg`.
- Automatically executes local Whisper transcription and Ollama structured extraction.
- Cleans up temporary audio files upon completion.

**Response format:**
```json
{
  "transcript": "Let's make sure Sarah completes the Q3 budget spreadsheet by Friday afternoon, and David reviews the security audit before next Monday.",
  "action_items": [
    {
      "task": "Complete the Q3 budget spreadsheet",
      "owner": "Sarah",
      "deadline": "Friday afternoon"
    },
    {
      "task": "Review the security audit",
      "owner": "David",
      "deadline": "Next Monday"
    }
  ],
  "model_used": "llama3.2",
  "whisper_model": "base",
  "detected_language": "en"
}
```

---

## 💡 Troubleshooting

- **Ollama Offline warning on UI:** Make sure Ollama is launched (`ollama serve`) and accessible at `http://localhost:11434`.
- **Microphone permission blocked:** Check your browser's site settings for `http://localhost:3000` and allow microphone access.
- **Port 8000 or 3000 in use:** You can run uvicorn on another port with `--port 8001`, and update `NEXT_PUBLIC_API_URL` in `frontend/.env.local`.
