"""
Voice Notes -> Action Items Backend
FastAPI server handling audio transcription (faster-whisper)
and action item extraction via local Ollama LLM.
"""

import os
import re
import json
import shutil
import tempfile
import logging
from typing import Optional, List, Dict, Any

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile, Query, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

# Load environment variables from .env file if available
load_dotenv()

# Configure logging for easy debugging in terminal
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("voice-notes-backend")

# Configuration options
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
DEFAULT_WHISPER_MODEL = os.getenv("DEFAULT_WHISPER_MODEL", "base")

# Allowed audio extensions and MIME types
ALLOWED_EXTENSIONS = {".mp3", ".wav", ".m4a", ".webm", ".ogg", ".aac", ".flac"}
ALLOWED_MIME_TYPES = {
    "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav",
    "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/webm",
    "audio/ogg", "application/octet-stream"
}

# Cache loaded Whisper models in memory so subsequent requests are fast
whisper_models_cache: Dict[str, WhisperModel] = {}

app = FastAPI(
    title="Voice Notes -> Action Items API",
    description="Offline voice note transcription and AI action-item extraction using faster-whisper and Ollama",
    version="1.0.0"
)

# Enable CORS (Cross-Origin Resource Sharing) so the Next.js frontend can call this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For local development; can restrict to ["http://localhost:3000"]
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_whisper_model(model_size: str = "base") -> WhisperModel:
    """
    Get or load a faster-whisper model by size.
    Uses CPU with int8 quantization for high compatibility across machines.
    """
    valid_sizes = {"tiny", "base", "small", "medium"}
    if model_size not in valid_sizes:
        model_size = "base"

    if model_size not in whisper_models_cache:
        logger.info(f"Loading faster-whisper model '{model_size}' into memory (device=cpu, compute_type=int8)...")
        # int8 quantization runs efficiently on CPUs without needing NVIDIA CUDA
        whisper_models_cache[model_size] = WhisperModel(model_size, device="cpu", compute_type="int8")
        logger.info(f"Whisper model '{model_size}' loaded successfully.")

    return whisper_models_cache[model_size]


def check_ollama_status() -> Dict[str, Any]:
    """
    Check if the local Ollama instance is reachable and list its installed models.
    """
    try:
        response = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3.0)
        if response.status_code == 200:
            data = response.json()
            models = [m.get("name") for m in data.get("models", [])]
            return {"online": True, "models": models}
        return {"online": False, "error": f"Ollama returned HTTP {response.status_code}", "models": []}
    except requests.exceptions.RequestException as err:
        return {"online": False, "error": str(err), "models": []}


def select_best_ollama_model(preferred_model: str, available_models: List[str]) -> str:
    """
    Choose the best model based on what is currently pulled in Ollama.
    Falls back gracefully if the preferred model is not yet installed.
    """
    if not available_models:
        return preferred_model

    # Check for exact or prefixed match (e.g. 'llama3.2' matches 'llama3.2:latest')
    for model in available_models:
        if model == preferred_model or model.startswith(f"{preferred_model}:"):
            return model

    # Fallback candidates in order of preference
    candidates = ["llama3.2", "llama3.1:8b", "llama3.1", "llama3", "phi3", "mistral", "gemma2"]
    for cand in candidates:
        for model in available_models:
            if model == cand or model.startswith(f"{cand}:"):
                return model

    # If none matched, use the first available model in Ollama
    return available_models[0]


def extract_action_items_with_ollama(transcript: str, chosen_model: str) -> List[Dict[str, Any]]:
    """
    Calls local Ollama REST API with prompt engineering to extract structured action items.
    Parses and sanitizes the JSON output defensively.
    """
    prompt = f"""You are an assistant that extracts action items from meeting or voice-note transcripts.
Given the transcript below, extract every actionable task mentioned.
For each task, identify:
- "task": a short, clear description of what needs to be done
- "owner": the person responsible, if mentioned, otherwise null
- "deadline": any date/deadline mentioned, otherwise null

Return ONLY a JSON array in this exact format, with no extra text, no markdown code fences:
[
  {{"task": "...", "owner": "...", "deadline": "..."}}
]

If no action items are found, return an empty array: []

Transcript:
\"\"\"
{transcript}
\"\"\""""

    payload = {
        "model": chosen_model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.1  # Low temperature for deterministic, structured output
        }
    }

    try:
        response = requests.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=60.0)
    except requests.exceptions.ConnectionError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                f"Cannot connect to Ollama at '{OLLAMA_URL}'. "
                "Please make sure Ollama is installed and running (e.g., run `ollama serve`), "
                f"and ensure you have pulled a model with `ollama pull {OLLAMA_MODEL}`."
            )
        )
    except requests.exceptions.Timeout:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Ollama took too long to generate a response (request timed out)."
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Ollama returned error code {response.status_code}: {response.text}"
        )

    response_data = response.json()
    raw_text = response_data.get("response", "").strip()
    logger.info(f"Raw Ollama LLM response:\n{raw_text}")

    # Defensive parsing of the JSON array from the raw LLM response
    return parse_action_items_json(raw_text)


def parse_action_items_json(raw_text: str) -> List[Dict[str, Any]]:
    """
    Defensively parses LLM output to extract a valid list of action items,
    handling markdown blocks, extra explanations, and single object returns.
    """
    cleaned = raw_text.strip()

    # Step 1: Remove markdown code fences if present (e.g., ```json ... ```)
    if "```" in cleaned:
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
        cleaned = cleaned.strip()

    # Step 2: Try direct JSON parse
    try:
        data = json.loads(cleaned)
        return normalize_action_items(data)
    except json.JSONDecodeError:
        pass

    # Step 3: Extract the first JSON array pattern [...]
    array_match = re.search(r"\[\s*\{.*\}\s*\]", cleaned, re.DOTALL)
    if array_match:
        try:
            data = json.loads(array_match.group(0))
            return normalize_action_items(data)
        except json.JSONDecodeError:
            pass

    # Step 4: Extract empty array pattern []
    if re.search(r"\[\s*\]", cleaned):
        return []

    # Step 5: Extract a single JSON object {...} if LLM returned one item without outer array
    object_match = re.search(r"\{[^{}]*\"task\"[^{}]*\}", cleaned, re.DOTALL)
    if object_match:
        try:
            data = json.loads(object_match.group(0))
            return normalize_action_items([data])
        except json.JSONDecodeError:
            pass

    logger.warning(f"Could not parse valid JSON from LLM response: {raw_text}")
    return []


def normalize_action_items(data: Any) -> List[Dict[str, Any]]:
    """
    Ensures the parsed structure is a list of dicts with task, owner, and deadline keys.
    """
    # If the LLM wrapped the array in a dict like {"action_items": [...]} or {"tasks": [...]}
    if isinstance(data, dict):
        for key in ["action_items", "tasks", "items", "actions"]:
            if key in data and isinstance(data[key], list):
                data = data[key]
                break
        else:
            # Single object treated as single-item list
            data = [data]

    if not isinstance(data, list):
        return []

    normalized = []
    for item in data:
        if isinstance(item, dict):
            task = item.get("task") or item.get("description") or item.get("action")
            if task and str(task).strip():
                normalized.append({
                    "task": str(task).strip(),
                    "owner": str(item.get("owner")).strip() if item.get("owner") else None,
                    "deadline": str(item.get("deadline")).strip() if item.get("deadline") else None
                })

    return normalized


# --- API Routes ---

@app.get("/")
def read_root():
    """Welcome endpoint providing service status and quick links."""
    return {
        "app": "Voice Notes -> Action Items API",
        "status": "online",
        "docs": "/docs",
        "health": "/health"
    }


@app.get("/health")
def health_check():
    """
    Health check endpoint: verifies backend status and Ollama connectivity.
    Useful for debugging configuration from frontend or curl.
    """
    ollama_info = check_ollama_status()
    recommended_model = OLLAMA_MODEL
    selected_model = select_best_ollama_model(recommended_model, ollama_info.get("models", []))

    return {
        "status": "healthy",
        "ollama": {
            "online": ollama_info.get("online", False),
            "url": OLLAMA_URL,
            "configured_model": recommended_model,
            "selected_model": selected_model,
            "available_models": ollama_info.get("models", []),
            "error": ollama_info.get("error")
        },
        "whisper": {
            "default_model": DEFAULT_WHISPER_MODEL,
            "loaded_models": list(whisper_models_cache.keys())
        }
    }


@app.post("/process-audio")
async def process_audio(
    file: UploadFile = File(...),
    whisper_model: Optional[str] = Query(
        DEFAULT_WHISPER_MODEL,
        description="Whisper model size: tiny, base, or small"
    )
):
    """
    Primary endpoint:
    1. Validates and saves audio to temporary file.
    2. Transcribes locally via faster-whisper.
    3. Calls local Ollama to extract structured action items.
    4. Cleans up temporary audio file.
    """
    # 1. Validate file extension or MIME type
    file_ext = os.path.splitext(file.filename or "")[1].lower()
    content_type = file.content_type or ""

    # Allow if either extension or MIME type is recognized
    is_valid_ext = file_ext in ALLOWED_EXTENSIONS
    is_valid_mime = any(content_type.startswith(m) for m in ["audio/", "video/webm"]) or content_type in ALLOWED_MIME_TYPES

    if not is_valid_ext and not is_valid_mime:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Unsupported file format '{file_ext}' (content-type: '{content_type}'). "
                f"Supported formats: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
            )
        )

    # 2. Save uploaded audio to a temporary file
    temp_suffix = file_ext if file_ext else ".webm"
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=temp_suffix)
    temp_file_path = temp_file.name

    try:
        logger.info(f"Receiving audio file '{file.filename}' (size ~ {file.size if hasattr(file, 'size') else 'unknown'})...")
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Check if saved file has content
        file_size = os.path.getsize(temp_file_path)
        if file_size == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded audio file is empty (0 bytes)."
            )

        # 3. Transcribe audio locally using faster-whisper
        model_size = whisper_model if whisper_model in ["tiny", "base", "small"] else "base"
        whisper = get_whisper_model(model_size)

        logger.info(f"Starting local transcription with Whisper '{model_size}'...")
        segments, info = whisper.transcribe(
            temp_file_path,
            beam_size=5,
            vad_filter=True  # Voice Activity Detection removes silence
        )

        transcript_parts = [segment.text.strip() for segment in segments if segment.text.strip()]
        full_transcript = " ".join(transcript_parts).strip()

        logger.info(f"Transcription complete (detected language: {info.language} with prob {info.language_probability:.2f}).")
        logger.info(f"Transcript preview: {full_transcript[:100]}...")

        if not full_transcript:
            return {
                "transcript": "",
                "action_items": [],
                "message": "No speech detected in the audio file.",
                "whisper_model": model_size,
                "detected_language": info.language
            }

        # 4. Check Ollama status and pick model
        ollama_info = check_ollama_status()
        if not ollama_info.get("online"):
            # Return transcript with helpful notice if Ollama is not yet active
            return {
                "transcript": full_transcript,
                "action_items": [],
                "ollama_status": "offline",
                "error": (
                    f"Ollama is not running on {OLLAMA_URL}. Transcript completed successfully, "
                    f"but action item extraction requires Ollama. Run `ollama serve` and `ollama pull {OLLAMA_MODEL}`."
                ),
                "whisper_model": model_size,
                "detected_language": info.language
            }

        chosen_model = select_best_ollama_model(OLLAMA_MODEL, ollama_info.get("models", []))
        logger.info(f"Calling Ollama with model '{chosen_model}' for action item extraction...")

        # 5. Extract action items via Ollama
        action_items = extract_action_items_with_ollama(full_transcript, chosen_model)

        return {
            "transcript": full_transcript,
            "action_items": action_items,
            "model_used": chosen_model,
            "whisper_model": model_size,
            "detected_language": info.language
        }

    finally:
        # 6. Always clean up temporary audio file
        if os.path.exists(temp_file_path):
            try:
                os.unlink(temp_file_path)
                logger.info("Cleaned up temporary audio file.")
            except Exception as e:
                logger.warning(f"Failed to delete temp file {temp_file_path}: {e}")
