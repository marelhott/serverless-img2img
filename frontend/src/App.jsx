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

function buildImageUrl(path) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("data:")) return path;
  return `${API_URL}${path}`;
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
  const [numImages, setNumImages] = useState(2);
  const [denoise, setDenoise] = useState(0.45);
  const [cfg, setCfg] = useState(5);
  const [steps, setSteps] = useState(25);
  const [sampler, setSampler] = useState("dpmpp_2m");
  const [schedule, setSchedule] = useState("karras");
  const [results, setResults] = useState([]);
  const [libraryItems, setLibraryItems] = useState([]);
  const [libraryOpen, setLibraryOpen] = useState(true);
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
    loadLibrary().catch(() => {});
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
          if (data.result?.library_items?.length) {
            setLibraryItems((current) => [...data.result.library_items, ...current]);
            setLibraryOpen(true);
          } else {
            loadLibrary().catch(() => {});
          }
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
  const visibleLogs = job.logs?.slice(-10) || [];

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

  async function loadLibrary() {
    const response = await fetch(`${API_URL}/api/library`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "Library load failed.");
    }
    setLibraryItems(data.items || []);
  }

  function openResultImage(image) {
    setSelectedImage({
      src: buildImageUrl(`data:image/${image.format || "png"};base64,${image.image_base64}`),
      width: image.width,
      height: image.height,
    });
  }

  function openLibraryImage(item) {
    setSelectedImage({
      src: buildImageUrl(item.url),
      width: item.width,
      height: item.height,
    });
  }

  return (
    <main className="app-shell">
      <aside className="app-panel app-panel-left">
        <div className="panel-intro">
          <div className="section-mark" />
          <div className="intro-copy">
            <h1>IMG2IMG</h1>
            <p>RUNPOD POD RUNTIME</p>
          </div>
        </div>

        <div className="panel-divider" />

        <section className="control-group upload-group">
          <SectionTitle title="UPLOAD IMAGE" />
          <label className="upload-frame">
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} />
            {previewUrl ? <img src={previewUrl} alt="Input" /> : <span className="upload-plus">+</span>}
            <span className="frame-corner frame-corner-tl" />
            <span className="frame-corner frame-corner-tr" />
            <span className="frame-corner frame-corner-bl" />
            <span className="frame-corner frame-corner-br" />
          </label>
          <div className="upload-foot">
            <span>{imageFile?.name || "No file"}</span>
            <strong>
              {imageSize.width} x {imageSize.height}
            </strong>
          </div>
        </section>

        <FieldSelect label="MODEL" value={modelId} onChange={setModelId} options={models} />
        <FieldSelect label="LORA" value={loraId} onChange={setLoraId} options={loras} />

        <SliderField label="IMAGES" value={String(numImages)}>
          <input type="range" min="1" max="4" step="1" value={numImages} onChange={(event) => setNumImages(Number(event.target.value))} />
        </SliderField>

        <label className="control-group resolution-group">
          <SectionTitle title="RESOLUTION" />
          <div className="resolution-head">
            <div className="resolution-box">
              <span>SOURCE</span>
              <strong>
                {imageSize.width} x {imageSize.height}
              </strong>
            </div>
            <div className="resolution-box">
              <span>TARGET</span>
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
        </label>
      </aside>

      <section className="app-panel app-panel-center">
        <div className="workspace-header">
          <div className="workspace-meta">
            <SectionTitle title="OUTPUTS" />
            <span className="workspace-subline">
              {results.length ? `${results.length} READY` : `${numImages} PLACEHOLDERS`}
            </span>
          </div>
          <button className="generate-button" disabled={isGenerating || !imageFile} onClick={handleGenerate}>
            {isGenerating ? "GENERATING" : "GENERATE"}
          </button>
        </div>

        <div className="panel-divider" />

        {error ? <div className="error-line">{error}</div> : null}

        <div className={`output-stage output-stage-${numImages}`}>
          {Array.from({ length: numImages }).map((_, index) => {
            const image = results[index];
            const imageSrc = image ? `data:image/${image.format || "png"};base64,${image.image_base64}` : "";
            return (
              <button
                key={index}
                type="button"
                className={`output-tile ${image ? "is-filled" : ""}`}
                onClick={() => image && openResultImage(image)}
                disabled={!image}
              >
                <span className="frame-corner frame-corner-tl" />
                <span className="frame-corner frame-corner-tr" />
                <span className="frame-corner frame-corner-bl" />
                <span className="frame-corner frame-corner-br" />

                {image ? (
                  <>
                    <img src={imageSrc} alt={`Output ${index + 1}`} />
                    <span className="output-dimensions">
                      {image.width} x {image.height}
                    </span>
                  </>
                ) : (
                  <div className="tile-state">
                    <strong>{isGenerating ? `${progressValue}%` : `#${index + 1}`}</strong>
                    <span>{isGenerating ? "GENERATING..." : "PLACEHOLDER"}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <aside className="app-panel app-panel-right">
        <SliderField label="DENOISE" value={denoise.toFixed(2)}>
          <input type="range" min="0.05" max="1" step="0.01" value={denoise} onChange={(event) => setDenoise(Number(event.target.value))} />
        </SliderField>

        <SliderField label="CFG" value={cfg.toFixed(1)}>
          <input type="range" min="1" max="20" step="0.1" value={cfg} onChange={(event) => setCfg(Number(event.target.value))} />
        </SliderField>

        <SliderField label="STEPS" value={String(steps)}>
          <input type="range" min="1" max="80" step="1" value={steps} onChange={(event) => setSteps(Number(event.target.value))} />
        </SliderField>

        <label className="control-group">
          <SectionTitle title="SAMPLER" />
          <select value={sampler} onChange={(event) => setSampler(event.target.value)}>
            {samplers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label className="control-group">
          <SectionTitle title="SCHEDULE" />
          <select value={schedule} onChange={(event) => setSchedule(event.target.value)}>
            {schedules.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <div className="panel-divider panel-divider-debug" />

        <section className="debug-strip">
          <div className="debug-strip-head">
            <span>PROGRESS</span>
            <strong>{progressValue}%</strong>
          </div>
          <div className="debug-strip-body">
            {visibleLogs.length ? (
              visibleLogs.map((entry, index) => (
                <div key={`${entry.timestamp}-${index}`} className="debug-strip-line">
                  <span>{formatTime(entry.timestamp)}</span>
                  <span>{Math.round((entry.progress || 0) * 100)}%</span>
                  <span>{entry.message}</span>
                </div>
              ))
            ) : (
              <div className="debug-strip-line">
                <span>--:--:--</span>
                <span>0%</span>
                <span>IDLE</span>
              </div>
            )}
          </div>
        </section>

        <section className={`library-panel ${libraryOpen ? "is-open" : ""}`}>
          <button type="button" className="library-toggle" onClick={() => setLibraryOpen((value) => !value)}>
            <span>LIBRARY</span>
            <strong>{libraryItems.length}</strong>
          </button>
          {libraryOpen ? (
            <div className="library-grid">
              {libraryItems.length ? (
                libraryItems.map((item) => (
                  <button key={item.id} type="button" className="library-thumb" onClick={() => openLibraryImage(item)}>
                    <img src={buildImageUrl(item.url)} alt={item.filename} loading="lazy" />
                  </button>
                ))
              ) : (
                <div className="library-empty">NO IMAGES</div>
              )}
            </div>
          ) : null}
        </section>
      </aside>

      {selectedImage ? (
        <div className="lightbox" onClick={() => setSelectedImage(null)}>
          <div className="lightbox-frame" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="lightbox-close" onClick={() => setSelectedImage(null)}>
              CLOSE
            </button>
            <img src={selectedImage.src} alt="Selected output" />
          </div>
        </div>
      ) : null}
    </main>
  );
}

function SectionTitle({ title }) {
  return (
    <div className="section-title">
      <span className="section-mark" />
      <strong>{title}</strong>
    </div>
  );
}

function FieldSelect({ label, value, onChange, options }) {
  return (
    <label className="control-group">
      <SectionTitle title={label} />
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function SliderField({ label, value, children }) {
  return (
    <label className="control-group slider-group">
      <div className="slider-head">
        <SectionTitle title={label} />
        <strong>{value}</strong>
      </div>
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
