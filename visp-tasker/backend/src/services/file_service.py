import shutil
import uuid
import os
from fastapi import UploadFile
from pathlib import Path

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

async def save_upload_file(file: UploadFile) -> str:
    """Save an uploaded file to the local filesystem and return its relative URL/path."""
    # Generate a unique filename
    ext = Path(file.filename).suffix if file.filename else ""
    unique_name = f"{uuid.uuid4()}{ext}"
    file_path = UPLOAD_DIR / unique_name
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    return str(file_path)
