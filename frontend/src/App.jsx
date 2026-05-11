import React, { useEffect, useMemo, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "";
const POLL_INTERVAL = 450;
const EMPTY_JOB = {
  id: "",
  status: "idle",
  progress: 0,
  message: "Idle",
  logs: [],
  result: null,
  error: null,
};

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function App() {
  const [models, setModels] = useState([]);
  const [loras, setLoras] = useState([]);
  const [samplers, setSamplers] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [imageSize, setImageSize] = useState({ width: 1024, height: 1024 });
  const [resizeScale, setResizeScale] = useState(1);
  const [modelId, setModelId] = useState("sdxl_base");
  const [loraId, setLoraId] = useState("none");
  const [numImages, setNumImages] = useState(1);
  const [denoise, setDenoise] = useState(0.35);
  const [cfg, setCfg] = useState(1.8);
  const [steps, setSteps] = useState(25);
  const [sampler, setSampler] = useState("dpmpp_2m");
  const [schedule, setSchedule] = useState("karras");
  const [results, setResults] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [error, setError] = useState("");
  const [job, setJob] = useState(EMPTY_JOB);
  const [jobId, setJobId] = useState("");

  useEffect(() => {
    fetch(`${API_URL}/api/options`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) return;
        if (data.models?.length) {
          setModels(data.models);
          setModelId(data.models[0].id);
        }
        if (data.loras?.length) {
          setLoras(data.loras);
          setLoraId(data.loras[0].id);
        }
        if (data.samplers?.length) {
          setSamplers(data.samplers);
          setSampler(data.samplers[0].id);
        }
        if (data.schedules?.length) {
          setSchedules(data.schedules);
          setSchedule(data.schedules[0].id);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!jobId) return undefined;

    let isCancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`${API_URL}/api/jobs/${jobId}`);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.detail || "Job polling failed.");
        }
        if (isCancelled) return;
        setJob(data);

        if (data.status === "completed") {
          setResults(data.result?.images || []);
          setError("");
          return;
        }

        if (data.status === "failed") {
          setError(data.error?.detail || "Generation failed.");
          return;
        }

        window.setTimeout(poll, POLL_INTERVAL);
      } catch (pollError) {
        if (!isCancelled) {
          setError(pollError.message);
          setJob((current) => ({
            ...current,
            status: "failed",
            message: pollError.message,
          }));
        }
      }
    };

    poll();
    return () => {
      isCancelled = true;
    };
  }, [jobId]);

  const targetSize = useMemo(() => {
    const width = normalizeMultipleOfEight(Math.round(imageSize.width * resizeScale));
    const height = normalizeMultipleOfEight(Math.round(imageSize.height * resizeScale));
    return { width, height };
  }, [imageSize, resizeScale]);

  const isGenerating =
    job.status === "preparing" || job.status === "queued" || job.status === "waiting" || job.status === "running";
  const progressValue = Math.max(0, Math.min(100, Math.round((job.progress || 0) * 100)));

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    const probe = new window.Image();
    probe.onload = () => {
      setImageSize({ width: probe.naturalWidth, height: probe.naturalHeight });
      setResizeScale(1);
    };
    probe.src = objectUrl;

    setImageFile(file);
    setPreviewUrl(objectUrl);
    setResults([]);
    setSelectedImage(null);
    setError("");
    setJob(EMPTY_JOB);
    setJobId("");
  }

  async function handleGenerate() {
    if (!imageFile) {
      setError("Upload image first.");
      return;
    }

    setError("");
    setResults([]);
    setSelectedImage(null);
    setJobId("");
    setJob({
      ...EMPTY_JOB,
      status: "preparing",
      message: "Encoding input image",
      logs: [{ timestamp: new Date().toISOString(), progress: 0, message: "Encoding input image" }],
    });

    try {
      const imageBase64 = await fileToBase64(imageFile);
      const response = await fetch(`${API_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_base64: imageBase64,
          model_id: modelId,
          lora_id: loraId,
          denoise: Number(denoise),
          lora_strength: 0.8,
          cfg: Number(cfg),
          steps: Number(steps),
          sampler,
          schedule,
          scale: scaleToPreset(resizeScale),
          num_images: Number(numImages),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || data.error || "Generation failed.");
      }

      setJobId(data.job_id);
    } catch (generationError) {
      setError(generationError.message);
      setJob({
        ...EMPTY_JOB,
        status: "failed",
        message: generationError.message,
        logs: [{ timestamp: new Date().toISOString(), progress: 1, message: generationError.message }],
      });
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar sidebar-left">
        <div className="sidebar-head">
          <div className="brand-mark" />
          <div className="brand-copy">
            <h1>Img2Img</h1>
            <p>RunPod pod runtime</p>
          </div>
        </div>

        <section className="panel-block">
          <label className="upload-dropzone">
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} />
            {previewUrl ? <img src={previewUrl} alt="Input" /> : <span>Upload image</span>}
          </label>
          <div className="upload-meta">
            <span>{imageFile?.name || "No file"}</span>
            <strong>
              {imageSize.width} x {imageSize.height}
            </strong>
          </div>
        </section>

        <SidebarField label="Model">
          <select value={modelId} onChange={(event) => setModelId(event.target.value)}>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </SidebarField>

        <SidebarField label="LoRA">
          <select value={loraId} onChange={(event) => setLoraId(event.target.value)}>
            {loras.map((lora) => (
              <option key={lora.id} value={lora.id}>
                {lora.name}
              </option>
            ))}
          </select>
        </SidebarField>

        <SidebarField label="Images">
          <select value={numImages} onChange={(event) => setNumImages(Number(event.target.value))}>
            {[1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </SidebarField>

        <SidebarField label="Resolution">
          <div className="resolution-readout">
            <div>
              <span>Source</span>
              <strong>
                {imageSize.width} x {imageSize.height}
              </strong>
            </div>
            <div>
              <span>Target</span>
              <strong>
                {targetSize.width} x {targetSize.height}
              </strong>
            </div>
          </div>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.05"
            value={resizeScale}
            onChange={(event) => setResizeScale(Number(event.target.value))}
          />
        </SidebarField>
      </aside>

      <section className="workspace">
        <div className="workspace-topbar">
          <div className="workspace-copy">
            <strong>Outputs</strong>
            <span>
              {isGenerating
                ? `${progressValue}% ${job.message || "Running"}`
                : results.length
                  ? `${results.length} ready`
                  : `${numImages} placeholders`}
            </span>
          </div>
          <button className="generate-button" disabled={isGenerating || !imageFile} onClick={handleGenerate}>
            {isGenerating ? "Generating" : "Generate"}
          </button>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}

        <div className={`output-grid output-grid-${numImages}`}>
          {Array.from({ length: numImages }).map((_, index) => {
            const image = results[index];
            return (
              <button
                key={index}
                type="button"
                className={`output-tile ${image ? "is-filled" : ""}`}
                onClick={() => image && setSelectedImage(image)}
                disabled={!image}
              >
                {image ? (
                  <>
                    <img src={`data:image/${image.format || "png"};base64,${image.image_base64}`} alt={`Output ${index + 1}`} />
                    <span>
                      {image.width} x {image.height}
                    </span>
                  </>
                ) : (
                  <span className="placeholder-label">{isGenerating ? "Generating" : `Output ${index + 1}`}</span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <aside className="sidebar sidebar-right">
        <SidebarField label="Denoise" value={denoise.toFixed(2)}>
          <input type="range" min="0.05" max="1" step="0.01" value={denoise} onChange={(event) => setDenoise(Number(event.target.value))} />
        </SidebarField>

        <SidebarField label="CFG" value={cfg.toFixed(1)}>
          <input type="range" min="1" max="20" step="0.1" value={cfg} onChange={(event) => setCfg(Number(event.target.value))} />
        </SidebarField>

        <SidebarField label="Steps" value={String(steps)}>
          <input type="range" min="1" max="80" step="1" value={steps} onChange={(event) => setSteps(Number(event.target.value))} />
        </SidebarField>

        <SidebarField label="Sampler">
          <select value={sampler} onChange={(event) => setSampler(event.target.value)}>
            {samplers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </SidebarField>

        <SidebarField label="Schedule">
          <select value={schedule} onChange={(event) => setSchedule(event.target.value)}>
            {schedules.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </SidebarField>

        <section className="debug-panel">
          <div className="debug-head">
            <div>
              <strong>Progress</strong>
              <span>{job.message}</span>
            </div>
            <strong>{progressValue}%</strong>
          </div>
          <div className="progress-track" aria-hidden="true">
            <div className="progress-fill" style={{ width: `${progressValue}%` }} />
          </div>
          <div className="debug-meta">
            <span>Status {job.status}</span>
            <span>{jobId ? `Job ${jobId.slice(0, 8)}` : "No job"}</span>
          </div>
          <div className="debug-log">
            {job.logs?.length ? (
              job.logs.map((entry, index) => (
                <div key={`${entry.timestamp}-${index}`} className="debug-line">
                  <span>{formatTime(entry.timestamp)}</span>
                  <strong>{Math.round((entry.progress || 0) * 100)}%</strong>
                  <p>{entry.message}</p>
                </div>
              ))
            ) : (
              <div className="debug-empty">No activity.</div>
            )}
          </div>
        </section>
      </aside>

      {selectedImage ? (
        <div className="lightbox" onClick={() => setSelectedImage(null)}>
          <div className="lightbox-frame" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="lightbox-close" onClick={() => setSelectedImage(null)}>
              Close
            </button>
            <img
              src={`data:image/${selectedImage.format || "png"};base64,${selectedImage.image_base64}`}
              alt="Selected output"
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}

function SidebarField({ label, value, children }) {
  return (
    <label className="sidebar-field">
      <span className="field-label">
        <em>{label}</em>
        {value ? <strong>{value}</strong> : null}
      </span>
      {children}
    </label>
  );
}

function normalizeMultipleOfEight(value) {
  return Math.max(64, Math.round(value / 8) * 8);
}

function scaleToPreset(scale) {
  if (scale <= 1.125) return 1;
  if (scale <= 1.375) return 1.25;
  if (scale <= 1.75) return 1.5;
  return 2;
}

function formatTime(isoValue) {
  const value = new Date(isoValue);
  return value.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default App;
