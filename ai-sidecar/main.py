import os
import re
import io
import time
import base64
import random
from typing import List, Optional
from datetime import datetime
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(
    title="NexaLink AI Sidecar",
    description="Speech Intelligence, Real-Time ASR & TTS Synthesis Microservice",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# SEC-21 FIX: Allowed audio MIME types for upload validation
ALLOWED_AUDIO_MIME_TYPES = {
    "audio/wav", "audio/wave", "audio/x-wav",
    "audio/mpeg", "audio/mp3",
    "audio/ogg", "audio/webm",
    "audio/flac", "audio/aac",
    "audio/mp4",
}
MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024  # 25 MB limit

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
client = None
if OPENAI_API_KEY:
    try:
        from openai import OpenAI
        client = OpenAI(api_key=OPENAI_API_KEY)
        print("[AI Sidecar] OpenAI API Key detected. Real models enabled.")
    except ImportError:
        print("[AI Sidecar] Warning: OpenAI key provided but openai package not installed.")

class ActionItem(BaseModel):
    task: str
    owner: str
    due_date: Optional[str] = None

class MeetingAnalysis(BaseModel):
    summary: str
    action_items: List[ActionItem]

class TTSRequest(BaseModel):
    text: str
    voice: str = "XTTS-v2 Host Male"
    pitch_factor: float = 1.0

# Health check
@app.get("/api/ai/health")
def ai_health():
    return {
        "status": "ONLINE",
        "service": "NexaLink AI Speech Sidecar",
        "has_openai_key": bool(OPENAI_API_KEY),
        "active_speech_pipelines": ["Whisper-ASR", "Coqui-XTTS-v2"]
    }

# Transcribe endpoint (Whisper ASR)
@app.post("/api/ai/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    room_name: str = Form(...)
):
    # SEC-21 FIX: Validate MIME type before processing
    content_type = file.content_type or ""
    if content_type not in ALLOWED_AUDIO_MIME_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{content_type}'. Allowed types: audio/wav, audio/mpeg, audio/ogg, audio/webm."
        )

    # SEC-21 FIX: Enforce maximum file size (read content into memory with size guard)
    content = await file.read(MAX_AUDIO_SIZE_BYTES + 1)
    if len(content) > MAX_AUDIO_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Audio file too large. Maximum allowed size is {MAX_AUDIO_SIZE_BYTES // (1024*1024)} MB."
        )

    start_time = time.time()
    if client:
        try:
            file_extension = ".wav" if content_type in ["audio/wav", "audio/wave", "audio/x-wav"] else ".mp3"
            if "webm" in content_type: file_extension = ".webm"
            elif "ogg" in content_type: file_extension = ".ogg"
            elif "mp4" in content_type: file_extension = ".mp4"
            
            file_obj = io.BytesIO(content)
            file_obj.name = f"audio{file_extension}"
            
            response = client.audio.transcriptions.create(
                model="whisper-1",
                file=file_obj,
                response_format="json"
            )
            text = response.text
        except Exception as e:
            print(f"[AI Speech] Error calling OpenAI Whisper API: {e}")
            raise HTTPException(status_code=500, detail="Failed to process audio with AI models.")
    else:
        # Safe rule-based context simulation matching real-world transcripts
        simulated_texts = [
            "Alice, please complete the database migration by Friday.",
            "We need to review the DTLS encryption code tomorrow morning.",
            "I will set up the TURN coturn server clusters this afternoon.",
            "Let's launch the k6 stress test on signaling sockets today at 5 PM."
        ]
        text = random.choice(simulated_texts)
    
    processing_time_ms = int((time.time() - start_time) * 1000)
    
    return {
        "room_name": room_name,
        "transcript": text,
        "language": "en",
        "timestamp": datetime.utcnow().isoformat(),
        "processing_time_ms": processing_time_ms
    }

# Speech generation endpoint (Coqui TTS)
@app.post("/api/ai/tts")
async def generate_speech(request: TTSRequest):
    print(f"[AI Speech] Synthesizing Voice <{request.voice}> (Pitch: {request.pitch_factor}): \"{request.text}\"")
    
    if client:
        try:
            openai_voice = "alloy"
            voice_map = {
                "XTTS-v2 Host Male": "onyx",
                "XTTS-v2 Host Female": "nova",
                "alloy": "alloy",
                "echo": "echo",
                "fable": "fable",
                "onyx": "onyx",
                "nova": "nova",
                "shimmer": "shimmer"
            }
            mapped_voice = voice_map.get(request.voice, openai_voice)
            
            response = client.audio.speech.create(
                model="tts-1",
                voice=mapped_voice,
                input=request.text
            )
            
            audio_content = response.content
            base64_audio = base64.b64encode(audio_content).decode('utf-8')
            
            return {
                "status": "SUCCESS",
                "voice": mapped_voice,
                "text": request.text,
                "audio_format": "mp3",
                "sample_rate": 24000,
                "base64_audio": base64_audio
            }
        except Exception as e:
            print(f"[AI Speech] Error calling OpenAI TTS API: {e}")
            raise HTTPException(status_code=500, detail="Failed to synthesize speech with AI models.")
    
    # Fallback to simulated base64 payload representation
    return {
        "status": "SUCCESS",
        "voice": request.voice,
        "text": request.text,
        "audio_format": "wav",
        "sample_rate": 24000,
        "base64_placeholder": "UklGRooHAABXQVZFZm10IBIAAAAEAAEAQB8AAEAfAAABAAgA"
    }

# Meeting Intelligence & Action Item Extraction
@app.post("/api/ai/actions", response_model=MeetingAnalysis)
def extract_action_items(transcript: str = Body(..., embed=True)):
    action_items = []
    
    # Rule-based NLP extraction looking for active patterns like "I will X", "Alice to Y", "by Z"
    # Looking for explicit owner assignments
    tasks_patterns = [
        r"(?P<owner>[A-Z][a-z]+)\s+(?:please|should|needs to)\s+(?P<task>[^.\n,]+)",
        r"(?P<owner>I)\s+will\s+(?P<task>[^.\n,]+)"
    ]
    
    for pattern in tasks_patterns:
        matches = re.finditer(pattern, transcript, re.IGNORECASE)
        for match in matches:
            groups = match.groupdict()
            owner = groups.get("owner", "Unassigned")
            task = groups.get("task", "").strip()
            
            # Simple date parsing representation
            due = None
            if "by" in task:
                parts = task.split("by")
                task = parts[0].strip()
                due = parts[1].strip()
                
            action_items.append(ActionItem(
                task=task,
                owner="Alice (Self)" if owner.lower() == "i" else owner,
                due_date=due
            ))
            
    # Standard summary generation
    summary = f"Summary of discussion logs: \"{transcript}\""
    
    # Fallback default task if no patterns matched
    if not action_items:
        action_items.append(ActionItem(
            task="Follow up on discussion points",
            owner="All Participants",
            due_date="Next Call"
        ))
        
    return MeetingAnalysis(
        summary=summary,
        action_items=action_items
    )
