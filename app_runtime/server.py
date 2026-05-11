from __future__ import annotations

from datetime import datetime, UTC
from pathlib import Path
import threading
import uuid
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app_runtime.core import generate, get_options, is_cuda_oom


app = FastAPI(title="Img2Img Runtime", version="0.1.0")
JOBS: dict[str, dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()
GENERATION_LOCK = threading.Lock()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/api/options")
def api_options():
    return get_options()


@app.post("/api/generate")
def api_generate(payload: dict):
    job_id = uuid.uuid4().hex
    job = {
        "id": job_id,
        "status": "queued",
        "progress": 0.0,
        "message": "Queued",
        "logs": [build_log("Queued", 0.0)],
        "result": None,
        "error": None,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "request": {
            "model_id": payload.get("model_id", "sdxl_base"),
            "lora_id": payload.get("lora_id", "none"),
            "num_images": payload.get("num_images", 1),
        },
    }
    with JOBS_LOCK:
        JOBS[job_id] = job

    thread = threading.Thread(target=run_job, args=(job_id, payload), daemon=True)
    thread.start()
    return {"job_id": job_id, "status": "queued"}


@app.get("/api/jobs/{job_id}")
def api_job_status(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found.")
        return job


dist_dir = Path(__file__).parent.parent / "frontend" / "dist"
if dist_dir.exists():
    app.mount("/", StaticFiles(directory=dist_dir, html=True), name="frontend")


def run_job(job_id: str, payload: dict[str, Any]) -> None:
    update_job(job_id, status="waiting", progress=0.01, message="Waiting for GPU slot")

    try:
        with GENERATION_LOCK:
            update_job(job_id, status="running", progress=0.03, message="GPU slot acquired")
            result = generate(payload, progress_callback=lambda progress, message: on_progress(job_id, progress, message))
            update_job(
                job_id,
                status="completed",
                progress=1.0,
                message="Completed",
                result=result,
            )
    except Exception as exc:
        status_code = 507 if is_cuda_oom(exc) else 500
        update_job(
            job_id,
            status="failed",
            progress=1.0,
            message="Failed",
            error={"detail": str(exc), "status_code": status_code},
        )


def on_progress(job_id: str, progress: float, message: str) -> None:
    update_job(job_id, status="running", progress=progress, message=message)


def update_job(
    job_id: str,
    *,
    status: str | None = None,
    progress: float | None = None,
    message: str | None = None,
    result: dict[str, Any] | None = None,
    error: dict[str, Any] | None = None,
) -> None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            return

        if status is not None:
            job["status"] = status
        if progress is not None:
            job["progress"] = min(max(progress, 0.0), 1.0)
        if message is not None:
            job["message"] = message
            if not job["logs"] or job["logs"][-1]["message"] != message:
                job["logs"].append(build_log(message, job["progress"]))
                job["logs"] = job["logs"][-120:]
        if result is not None:
            job["result"] = result
        if error is not None:
            job["error"] = error
        job["updated_at"] = now_iso()


def build_log(message: str, progress: float) -> dict[str, Any]:
    return {
        "timestamp": now_iso(),
        "progress": round(min(max(progress, 0.0), 1.0), 4),
        "message": message,
    }


def now_iso() -> str:
    return datetime.now(UTC).isoformat()
