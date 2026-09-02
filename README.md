# Voice Notes → Action Items — Speech → STT → LLM → Action Items

A beginner-friendly complete full-stack project based on the **LLMs Meet Speech** concept, running **100% locally & offline** with no paid cloud APIs.

---

## What it does

- **Upload mode:** Audio File (`.mp3`, `.wav`, `.m4a`, `.webm`, `.ogg`) → Speech-to-Text (`faster-whisper`) → Local LLM (`Ollama`) → Structured Tasks (`Task`, `Owner`, `Deadline`)
- **Voice mode:** Browser Microphone (`MediaRecorder` API) → Speech-to-Text (`faster-whisper`) → Local LLM (`Ollama`) → Structured Tasks (`Task`, `Owner`, `Deadline`)
- **Export mode:** One-click "Copy as Text" or download as a clean Markdown table (`.md`)

---

## Run locally

### 1. Start Ollama & pull model
```bash
ollama serve
ollama pull llama3.2
```

### 2. Start Backend (FastAPI)
```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
*API will run at [http://127.0.0.1:8000](http://127.0.0.1:8000) (Interactive Swagger Docs at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs))*

### 3. Start Frontend (Next.js)
```powershell
cd frontend
npm install
npm run dev -- --port 3000
```
*Open [http://localhost:3000](http://localhost:3000) in your browser.*

---

## Demo

1. **Upload Demo:** Drag-and-drop any voice memo or meeting audio file into the upload zone, then click **Process Recording**.
2. **Microphone Demo:** Click **Record Microphone**, read this sample meeting recap out loud, and click **Stop Recording**:
   > *"Quick sync: Alex needs to finish the API documentation by this Thursday, and Priya will review the database migration before Friday at 5 PM. Also, someone should test the payment gateway before next Monday."*
3. **Inspect Output:**
   - **Raw Transcript:** Accurate text generated locally by Faster-Whisper.
   - **Action Items Table:** Clean extracted columns for **#** | **Task** | **Owner** | **Deadline**.
   - **Export:** Click **Export Markdown** or **Copy as Text**.

---

## Learning flow

```
Microphone / Audio File
          │
          ▼
Speech-to-Text (faster-whisper)
          │
          ▼
Raw Transcript Text
          │
          ▼
Local LLM (Ollama — llama3.2)
          │
          ▼
Defensive JSON Parsing
          │
          ▼
Structured Action Items Table (Task | Owner | Deadline)
```

The project deliberately keeps the AI components separate so students can understand each step of the pipeline:
1. **Speech-to-Text (`faster-whisper`):** Converts raw acoustic audio into high-accuracy text locally on your CPU using quantized `int8` weights.
2. **LLM Reasoning (`Ollama`):** Uses deterministic prompt engineering (`llama3.2`) to extract structured action items without sending data to external servers.
3. **Defensive Parser:** Sanitizes the raw LLM output (stripping markdown fences or extra explanations) into valid JSON.
4. **Interactive UI (`Next.js` + `Tailwind CSS`):** Handles in-browser microphone recording, audio playback previews, health indicators, and task export.

---

## Extensions

- **Persistent Database:** Local SQLite storage with SQLAlchemy for full history and search
- **Speaker Diarization:** Acoustic voice profiling to identify *who* is speaking in multi-person meetings
- **Streaming WebSockets:** Live progressive transcription as the user speaks
- **Productivity Integrations:** One-click export to Notion, Todoist, Trello, or Google Calendar
- **Selectable Whisper Models:** Toggle between `tiny`, `base`, and `small` to balance speed and accuracy
- **Multi-language Support:** Automatically detect foreign languages and translate them into English action items
