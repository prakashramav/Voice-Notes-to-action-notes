"use client";

import { useState, useRef, useEffect } from "react";

// The FastAPI backend URL loaded from environment variable, falling back to localhost:8000
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function Home() {
  // --- State Variables ---

  // Audio source selection: 'upload' or 'record'
  const [activeTab, setActiveTab] = useState("upload");

  // Selected audio file from upload
  const [selectedFile, setSelectedFile] = useState(null);

  // Recorded audio state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordedAudioBlob, setRecordedAudioBlob] = useState(null);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState(null);

  // Model selection (stretch goal: tiny, base, small)
  const [whisperModel, setWhisperModel] = useState("base");

  // Processing and Loading state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  // Results state
  const [transcript, setTranscript] = useState("");
  const [actionItems, setActionItems] = useState([]);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(true);
  const [copySuccess, setCopySuccess] = useState("");

  // Backend & Ollama health status
  const [backendHealth, setBackendHealth] = useState({
    checked: false,
    backendOnline: false,
    ollamaOnline: false,
    model: "",
  });

  // History of previous processed notes (stored in localStorage)
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  // References for MediaRecorder and audio timing
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const fileInputRef = useRef(null);

  // --- Effects ---

  // Check health on mount and every 30 seconds
  useEffect(() => {
    checkHealth();
    loadHistory();

    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  // Cleanup object URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (recordedAudioUrl) {
        URL.revokeObjectURL(recordedAudioUrl);
      }
    };
  }, [recordedAudioUrl]);

  // --- Helper Functions ---

  /**
   * Pings the backend /health endpoint to verify FastAPI and Ollama status
   */
  async function checkHealth() {
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      if (response.ok) {
        const data = await response.json();
        setBackendHealth({
          checked: true,
          backendOnline: true,
          ollamaOnline: data.ollama?.online || false,
          model: data.ollama?.selected_model || data.ollama?.configured_model || "llama3.2",
        });
      } else {
        setBackendHealth({
          checked: true,
          backendOnline: true,
          ollamaOnline: false,
          model: "",
        });
      }
    } catch {
      setBackendHealth({
        checked: true,
        backendOnline: false,
        ollamaOnline: false,
        model: "",
      });
    }
  }

  /**
   * Load history from browser's localStorage
   */
  function loadHistory() {
    try {
      const saved = localStorage.getItem("voice_notes_history");
      if (saved) {
        setHistory(JSON.parse(saved));
      }
    } catch (e) {
      console.error("Failed to load history from localStorage:", e);
    }
  }

  /**
   * Save a newly processed item into history
   */
  function saveToHistory(newItem) {
    try {
      const updated = [newItem, ...history].slice(0, 15); // keep last 15
      setHistory(updated);
      localStorage.setItem("voice_notes_history", JSON.stringify(updated));
    } catch (e) {
      console.error("Failed to save history:", e);
    }
  }

  /**
   * Clear all history from localStorage
   */
  function clearHistory() {
    localStorage.removeItem("voice_notes_history");
    setHistory([]);
  }

  // --- Microphone Recording Functions ---

  /**
   * Starts recording using the browser's MediaRecorder API
   */
  async function startRecording() {
    setErrorMessage("");
    setRecordedAudioBlob(null);
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl);
      setRecordedAudioUrl(null);
    }
    audioChunksRef.current = [];

    // Clear any previous timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      // Request microphone access from user
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Determine supported mime type
      let mimeType = "audio/webm";
      if (typeof MediaRecorder !== "undefined") {
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
          mimeType = "audio/webm;codecs=opus";
        } else if (MediaRecorder.isTypeSupported("audio/webm")) {
          mimeType = "audio/webm";
        } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
          mimeType = "audio/mp4";
        } else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
          mimeType = "audio/ogg;codecs=opus";
        }
      }

      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;

      // Collect audio chunks as they arrive
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // When recording stops, assemble audio blob and create playable URL
      mediaRecorder.onstop = () => {
        try {
          const type = mediaRecorder.mimeType || mimeType || "audio/webm";
          const audioBlob = new Blob(audioChunksRef.current, { type });
          setRecordedAudioBlob(audioBlob);
          const audioUrl = URL.createObjectURL(audioBlob);
          setRecordedAudioUrl(audioUrl);
        } catch (e) {
          console.error("Error creating recorded audio blob:", e);
        } finally {
          setIsRecording(false);
          // Release hardware microphone
          if (streamRef.current) {
            try {
              streamRef.current.getTracks().forEach((track) => track.stop());
            } catch (err) {
              console.error("Error stopping tracks in onstop:", err);
            }
            streamRef.current = null;
          }
        }
      };

      // Start recording
      mediaRecorder.start(250); // collect chunk every 250ms
      setIsRecording(true);
      setRecordingDuration(0);

      // Start duration timer
      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone access error:", err);
      setIsRecording(false);
      setErrorMessage(
        "Could not access your microphone. Please allow microphone permissions in your browser settings."
      );
    }
  }

  /**
   * Stops active microphone recording reliably
   */
  function stopRecording() {
    // 1. Clear timer immediately
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // 2. Set state immediately so UI updates instantly
    setIsRecording(false);

    // 3. Request MediaRecorder to stop
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      } catch (err) {
        console.error("Error stopping mediaRecorder:", err);
      }
    }

    // 4. Stop audio hardware tracks to turn off the browser recording dot
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => track.stop());
      } catch (err) {
        console.error("Error stopping audio tracks:", err);
      }
      streamRef.current = null;
    }
  }

  /**
   * Reset / discard the current recorded audio
   */
  function discardRecording() {
    stopRecording();
    setRecordedAudioBlob(null);
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl);
      setRecordedAudioUrl(null);
    }
    setRecordingDuration(0);
  }

  // --- File Upload Handlers ---

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setErrorMessage("");
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      setSelectedFile(file);
      setErrorMessage("");
    }
  }

  function handleDragOver(event) {
    event.preventDefault();
  }

  // --- Format Duration helper ---
  function formatSeconds(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }

  // --- API Submission: Process Audio ---

  /**
   * Sends audio (uploaded file or recorded blob) to FastAPI /process-audio
   */
  async function handleProcessRecording() {
    setErrorMessage("");
    setIsProcessing(true);
    setProcessingStatus("Preparing audio for local processing...");

    // Get the audio file to send
    let audioToSend = null;
    let fileName = "recording.webm";

    if (activeTab === "upload") {
      if (!selectedFile) {
        setErrorMessage("Please select an audio file first.");
        setIsProcessing(false);
        return;
      }
      audioToSend = selectedFile;
      fileName = selectedFile.name;
    } else {
      if (!recordedAudioBlob) {
        setErrorMessage("Please record some audio before processing.");
        setIsProcessing(false);
        return;
      }
      audioToSend = recordedAudioBlob;
      fileName = "voice-note.webm";
    }

    // Prepare FormData payload for FastAPI multipart/form-data
    const formData = new FormData();
    formData.append("file", audioToSend, fileName);

    try {
      setProcessingStatus("Transcribing locally with faster-whisper...");

      // Call backend endpoint
      const response = await fetch(
        `${API_BASE_URL}/process-audio?whisper_model=${whisperModel}`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "An error occurred while processing the audio note."
        );
      }

      // Check if Ollama was offline or speech was empty
      if (data.message) {
        setErrorMessage(data.message);
      }
      if (data.error) {
        setErrorMessage(data.error);
      }

      // Store results in state
      setTranscript(data.transcript || "");
      const items = data.action_items || [];
      setActionItems(items);
      setIsTranscriptOpen(true);

      // Save to recent history
      if (data.transcript) {
        saveToHistory({
          id: Date.now(),
          date: new Date().toLocaleDateString() + " " + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          transcript: data.transcript,
          actionItems: items,
          model: data.model_used || whisperModel,
        });
      }
    } catch (err) {
      console.error("Processing error:", err);
      setErrorMessage(
        err.message ||
          "Failed to connect to the backend server. Make sure the FastAPI server is running on " +
            API_BASE_URL
      );
    } finally {
      setIsProcessing(false);
      setProcessingStatus("");
    }
  }

  // --- Export & Copy Handlers ---

  /**
   * Copies action items as clean formatted plain text
   */
  function handleCopyAsText() {
    if (actionItems.length === 0) return;

    let text = "Action Items:\n\n";
    actionItems.forEach((item, index) => {
      text += `${index + 1}. ${item.task}\n`;
      text += `   - Owner: ${item.owner || "Unassigned"}\n`;
      text += `   - Deadline: ${item.deadline || "No deadline"}\n\n`;
    });

    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess("text");
      setTimeout(() => setCopySuccess(""), 2000);
    });
  }

  /**
   * Exports action items as a downloadable Markdown document
   */
  function handleExportMarkdown() {
    if (actionItems.length === 0) return;

    let md = `# Meeting Action Items\n\n`;
    md += `*Generated on ${new Date().toLocaleString()}*\n\n`;
    md += `## 📋 Action Items\n\n`;
    md += `| # | Task | Owner | Deadline |\n`;
    md += `|---|------|-------|----------|\n`;

    actionItems.forEach((item, idx) => {
      const task = (item.task || "").replace(/\|/g, "\\|");
      const owner = item.owner || "—";
      const deadline = item.deadline || "—";
      md += `| ${idx + 1} | ${task} | ${owner} | ${deadline} |\n`;
    });

    md += `\n## 🎙️ Transcript\n\n`;
    md += `> ${transcript || "No transcript provided."}\n`;

    // Download file
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `action-items-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setCopySuccess("markdown");
    setTimeout(() => setCopySuccess(""), 2000);
  }

  /**
   * Copies raw transcript to clipboard
   */
  function handleCopyTranscript() {
    if (!transcript) return;
    navigator.clipboard.writeText(transcript).then(() => {
      setCopySuccess("transcript");
      setTimeout(() => setCopySuccess(""), 2000);
    });
  }

  // Load an item from history into active view
  function loadHistoryItem(item) {
    setTranscript(item.transcript);
    setActionItems(item.actionItems);
    setIsTranscriptOpen(true);
    setShowHistory(false);
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 antialiased selection:bg-indigo-600 selection:text-white">
      {/* --- Top Navigation / Header --- */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                Voice Notes <span className="text-indigo-400">→</span> Action Items
              </h1>
              <p className="text-xs text-slate-400">
                100% Offline AI • Faster-Whisper + Ollama
              </p>
            </div>
          </div>

          {/* System Status Indicators */}
          <div className="flex items-center gap-3 text-xs">
            {/* Backend Status Pill */}
            <div
              id="status-backend-pill"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all ${
                backendHealth.backendOnline
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : "bg-rose-500/10 border-rose-500/30 text-rose-400"
              }`}
              title={`FastAPI backend: ${backendHealth.backendOnline ? "Online" : "Offline"}`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  backendHealth.backendOnline ? "bg-emerald-400 animate-pulse" : "bg-rose-400"
                }`}
              />
              <span>FastAPI {backendHealth.backendOnline ? ":8000" : "Offline"}</span>
            </div>

            {/* Ollama Status Pill */}
            <div
              id="status-ollama-pill"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all ${
                backendHealth.ollamaOnline
                  ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-300"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-300"
              }`}
              title={`Ollama: ${backendHealth.ollamaOnline ? `Running (${backendHealth.model})` : "Offline (Run 'ollama serve')"}`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  backendHealth.ollamaOnline ? "bg-indigo-400" : "bg-amber-400"
                }`}
              />
              <span>
                Ollama {backendHealth.ollamaOnline ? `(${backendHealth.model})` : "Offline"}
              </span>
            </div>

            {/* History Toggle Button */}
            {history.length > 0 && (
              <button
                id="btn-toggle-history"
                onClick={() => setShowHistory(!showHistory)}
                className="px-2.5 py-1 rounded-full border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>History ({history.length})</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* --- Main Content --- */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Offline Banner alert if Ollama is offline */}
        {backendHealth.checked && !backendHealth.ollamaOnline && (
          <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-200 text-sm flex items-start gap-3">
            <svg
              className="w-5 h-5 text-amber-400 mt-0.5 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div className="space-y-1">
              <p className="font-semibold text-amber-100">
                Ollama is not running locally
              </p>
              <p className="text-xs text-amber-300/90 leading-relaxed">
                Audio will be transcribed using Faster-Whisper, but action item extraction requires Ollama. Run:
                <code className="mx-1 px-1.5 py-0.5 rounded bg-amber-900/60 font-mono text-xs">
                  ollama serve
                </code>
                and ensure a model is pulled:
                <code className="mx-1 px-1.5 py-0.5 rounded bg-amber-900/60 font-mono text-xs">
                  ollama pull llama3.2
                </code>
              </p>
            </div>
          </div>
        )}

        {/* --- Input Section: Recording & Upload --- */}
        <section className="glass-panel rounded-2xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
          {/* Subtle decorative glow */}
          <div className="absolute -top-24 -right-24 w-72 h-72 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Tab Switcher & Settings */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800/80">
            {/* Tabs */}
            <div className="inline-flex p-1 rounded-xl bg-slate-900 border border-slate-800">
              <button
                id="tab-upload"
                onClick={() => setActiveTab("upload")}
                className={`px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${
                  activeTab === "upload"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Upload Audio
              </button>

              <button
                id="tab-record"
                onClick={() => setActiveTab("record")}
                className={`px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${
                  activeTab === "record"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z" />
                </svg>
                Record Microphone
              </button>
            </div>

            {/* Whisper Model Size Selector (Stretch Goal) */}
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <label htmlFor="select-whisper-model" className="font-medium">
                Whisper Model:
              </label>
              <select
                id="select-whisper-model"
                value={whisperModel}
                onChange={(e) => setWhisperModel(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="tiny">Tiny (Fastest, ~75MB)</option>
                <option value="base">Base (Balanced, Recommended)</option>
                <option value="small">Small (High Accuracy, ~480MB)</option>
              </select>
            </div>
          </div>

          {/* Tab Content */}
          <div className="pt-6">
            {activeTab === "upload" ? (
              /* --- Upload Box --- */
              <div
                id="dropzone-area"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() => fileInputRef.current?.click()}
                className="cursor-pointer border-2 border-dashed border-slate-700 hover:border-indigo-500/70 rounded-xl p-8 text-center transition-all bg-slate-900/40 hover:bg-slate-900/70 group"
              >
                <input
                  ref={fileInputRef}
                  id="input-audio-file"
                  type="file"
                  accept=".mp3,.wav,.m4a,.webm,.ogg,audio/*"
                  onChange={handleFileChange}
                  className="hidden"
                />

                <div className="w-14 h-14 rounded-full bg-slate-800 group-hover:bg-indigo-950/60 group-hover:text-indigo-400 text-slate-400 mx-auto flex items-center justify-center transition-colors mb-3">
                  <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>

                {selectedFile ? (
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-indigo-300">
                      {selectedFile.name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • Click or drag another file to replace
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-slate-200">
                      Click to browse or drag and drop your voice recording
                    </p>
                    <p className="text-xs text-slate-500">
                      Supports MP3, WAV, M4A, WEBM, OGG
                    </p>
                  </div>
                )}
              </div>
            ) : (
              /* --- Microphone Recorder --- */
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 flex flex-col items-center justify-center text-center space-y-6">
                {/* Visual pulsating recording button */}
                <div className="relative flex items-center justify-center">
                  {isRecording && (
                    <div className="absolute w-24 h-24 rounded-full bg-rose-500/20 recording-pulse" />
                  )}

                  {!isRecording ? (
                    <button
                      id="btn-start-record"
                      onClick={startRecording}
                      className="w-20 h-20 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow-lg shadow-rose-600/30 transition-transform active:scale-95 focus:outline-none focus:ring-4 focus:ring-rose-500/30"
                      title="Start Recording"
                    >
                      <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      id="btn-stop-record"
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        stopRecording();
                      }}
                      className="w-20 h-20 rounded-full bg-slate-800 border-2 border-rose-500 text-rose-400 hover:bg-slate-700 flex items-center justify-center shadow-lg transition-transform active:scale-95 focus:outline-none cursor-pointer"
                      title="Click to Stop Recording"
                    >
                      <div className="w-6 h-6 rounded-sm bg-rose-500" />
                    </button>
                  )}
                </div>

                {/* Status & Timer */}
                <div className="space-y-1">
                  {isRecording ? (
                    <>
                      <div className="flex items-center justify-center gap-2 text-rose-400 font-medium text-sm">
                        <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                        Recording in progress
                      </div>
                      <p className="font-mono text-3xl font-bold text-white tracking-wider">
                        {formatSeconds(recordingDuration)}
                      </p>
                      {/* Prominent Stop & Cancel Action Buttons */}
                      <div className="pt-4 flex items-center justify-center gap-3">
                        <button
                          id="btn-stop-record-bar"
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            stopRecording();
                          }}
                          className="px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm shadow-lg shadow-rose-600/30 flex items-center gap-2 transition-all active:scale-95 cursor-pointer"
                        >
                          <div className="w-3.5 h-3.5 rounded-sm bg-white" />
                          <span>Stop Recording</span>
                        </button>
                        <button
                          id="btn-cancel-record"
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            discardRecording();
                          }}
                          className="px-4 py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : recordedAudioBlob ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-center gap-2 text-emerald-400 font-medium text-sm">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Recording ready ({formatSeconds(recordingDuration)})
                      </div>

                      {/* Playback preview */}
                      {recordedAudioUrl && (
                        <div className="pt-2">
                          <audio
                            id="player-audio-preview"
                            controls
                            src={recordedAudioUrl}
                            className="h-10 mx-auto rounded-lg max-w-sm"
                          />
                        </div>
                      )}

                      <div className="flex items-center justify-center gap-3 pt-2">
                        <button
                          id="btn-rerecord"
                          onClick={startRecording}
                          className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 transition-colors"
                        >
                          Record Again
                        </button>
                        <button
                          id="btn-discard-recording"
                          onClick={discardRecording}
                          className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-rose-400 hover:bg-slate-800 transition-colors"
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-slate-300">
                        Click the microphone button to start recording
                      </p>
                      <p className="text-xs text-slate-500">
                        Uses in-browser MediaRecorder API • No cloud transmission
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Error Message Box */}
          {errorMessage && (
            <div className="mt-4 p-4 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-200 text-sm flex items-start gap-3">
              <svg className="w-5 h-5 text-rose-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1 text-xs sm:text-sm">{errorMessage}</div>
              <button
                onClick={() => setErrorMessage("")}
                className="text-rose-400 hover:text-rose-200"
              >
                ✕
              </button>
            </div>
          )}

          {/* Process Recording Button */}
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs text-slate-400">
              {activeTab === "upload"
                ? selectedFile
                  ? `Selected: ${selectedFile.name}`
                  : "No file selected"
                : recordedAudioBlob
                ? `Recording ready (${formatSeconds(recordingDuration)})`
                : "No recording captured"}
            </div>

            <button
              id="btn-process-recording"
              onClick={handleProcessRecording}
              disabled={
                isProcessing ||
                (activeTab === "upload" && !selectedFile) ||
                (activeTab === "record" && !recordedAudioBlob)
              }
              className={`w-full sm:w-auto px-6 py-3 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
                isProcessing ||
                (activeTab === "upload" && !selectedFile) ||
                (activeTab === "record" && !recordedAudioBlob)
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50"
                  : "bg-gradient-to-r from-indigo-500 via-indigo-600 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white shadow-lg shadow-indigo-500/25 active:scale-98"
              }`}
            >
              {isProcessing ? (
                <>
                  <svg className="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>Process Recording</span>
                </>
              )}
            </button>
          </div>

          {/* Loading status text with progress indicator */}
          {isProcessing && (
            <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center gap-3 text-xs text-indigo-300">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
              </span>
              <span>{processingStatus}</span>
            </div>
          )}
        </section>

        {/* --- History Modal / Drawer (Stretch Goal) --- */}
        {showHistory && (
          <section className="glass-panel rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-base font-semibold text-slate-200 flex items-center gap-2">
                <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Recent Recordings History
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={clearHistory}
                  className="text-xs text-rose-400 hover:text-rose-300 transition-colors"
                >
                  Clear History
                </button>
                <button
                  onClick={() => setShowHistory(false)}
                  className="text-slate-400 hover:text-white text-sm"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 max-h-72 overflow-y-auto pr-1">
              {history.map((item) => (
                <div
                  key={item.id}
                  onClick={() => loadHistoryItem(item)}
                  className="p-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-indigo-500/50 cursor-pointer transition-all space-y-2 group"
                >
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>{item.date}</span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-indigo-300">
                      {item.actionItems?.length || 0} tasks
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 line-clamp-2 italic">
                    "{item.transcript}"
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* --- Results Section (Transcript + Action Items) --- */}
        {(transcript || actionItems.length > 0) && (
          <section className="space-y-6">
            {/* Header & Export Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  <span>Extracted Results</span>
                  <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-normal">
                    {actionItems.length} {actionItems.length === 1 ? "task" : "tasks"} found
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  Tasks identified by local LLM from transcribed voice note
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  id="btn-copy-text"
                  onClick={handleCopyAsText}
                  disabled={actionItems.length === 0}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                  </svg>
                  <span>{copySuccess === "text" ? "Copied!" : "Copy as Text"}</span>
                </button>

                <button
                  id="btn-export-markdown"
                  onClick={handleExportMarkdown}
                  disabled={actionItems.length === 0}
                  className="px-3 py-1.5 rounded-lg border border-indigo-600/40 bg-indigo-950/40 hover:bg-indigo-900/50 text-xs font-medium text-indigo-200 transition-colors flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>{copySuccess === "markdown" ? "Downloaded!" : "Export Markdown"}</span>
                </button>
              </div>
            </div>

            {/* --- Action Items Table --- */}
            <div className="glass-panel rounded-2xl overflow-hidden shadow-xl">
              {actionItems.length > 0 ? (
                <div className="overflow-x-auto">
                  <table id="table-action-items" className="w-full text-left text-sm">
                    <thead className="bg-slate-900/90 border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      <tr>
                        <th className="py-3.5 px-4 w-12 text-center">#</th>
                        <th className="py-3.5 px-4">Action Item / Task</th>
                        <th className="py-3.5 px-4 w-48">Owner</th>
                        <th className="py-3.5 px-4 w-48">Deadline</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {actionItems.map((item, index) => (
                        <tr
                          key={index}
                          className="hover:bg-slate-900/40 transition-colors group"
                        >
                          <td className="py-4 px-4 text-center font-mono text-xs text-slate-500">
                            {index + 1}
                          </td>
                          <td className="py-4 px-4 text-slate-200 font-medium leading-relaxed">
                            {item.task}
                          </td>
                          <td className="py-4 px-4">
                            {item.owner ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium">
                                <svg className="w-3 h-3 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                                </svg>
                                {item.owner}
                              </span>
                            ) : (
                              <span className="text-slate-500 text-xs italic">
                                Unassigned
                              </span>
                            )}
                          </td>
                          <td className="py-4 px-4">
                            {item.deadline ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-sky-500/10 border border-sky-500/30 text-sky-300 text-xs font-medium">
                                <svg className="w-3 h-3 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                {item.deadline}
                              </span>
                            ) : (
                              <span className="text-slate-500 text-xs italic">
                                None mentioned
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-8 text-center space-y-2">
                  <div className="w-12 h-12 rounded-full bg-slate-900 mx-auto flex items-center justify-center text-slate-500">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-slate-300">
                    No action items identified
                  </p>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    The voice note was transcribed, but the model did not detect explicit tasks, assignments, or deadlines.
                  </p>
                </div>
              )}
            </div>

            {/* --- Collapsible Raw Transcript Section --- */}
            {transcript && (
              <div className="glass-panel rounded-2xl p-5 shadow-xl transition-all">
                <div className="flex items-center justify-between">
                  <button
                    id="btn-toggle-transcript"
                    onClick={() => setIsTranscriptOpen(!isTranscriptOpen)}
                    className="flex items-center gap-2 text-sm font-semibold text-slate-200 hover:text-white transition-colors"
                  >
                    <svg
                      className={`w-4 h-4 text-slate-400 transform transition-transform ${
                        isTranscriptOpen ? "rotate-90" : ""
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span>Raw Transcript</span>
                    <span className="text-xs text-slate-500 font-normal">
                      ({transcript.split(/\s+/).filter(Boolean).length} words)
                    </span>
                  </button>

                  <button
                    id="btn-copy-transcript"
                    onClick={handleCopyTranscript}
                    className="text-xs text-slate-400 hover:text-indigo-300 transition-colors flex items-center gap-1"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span>{copySuccess === "transcript" ? "Copied!" : "Copy Transcript"}</span>
                  </button>
                </div>

                {isTranscriptOpen && (
                  <div className="mt-4 pt-3 border-t border-slate-800 text-sm text-slate-300 leading-relaxed font-normal bg-slate-900/60 p-4 rounded-xl border border-slate-800/80 select-text">
                    "{transcript}"
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </main>

      {/* --- Footer --- */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-600">
        <p>
          Voice Notes → Action Items • Fully Offline Speech-to-Text & Local LLM Processing
        </p>
      </footer>
    </div>
  );
}
