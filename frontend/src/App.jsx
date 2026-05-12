import React, { useEffect, useMemo, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "";
const POLL_INTERVAL = 450;
const PRESET_STORAGE_KEY = "img2img-presets-v1";
const DEFAULT_SAMPLER = "dpmpp_2m";
const DEFAULT_SCHEDULE = "karras";
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

function loadStoredPresets() {
  try {
    const raw = window.localStorage.getItem(PRESET_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStoredPresets(presets) {
  window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
}

function App() {
  const [models, setModels] = useState([]);
  const [loras, setLoras] = useState([]);
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [imageSize, setImageSize] = useState({ width: 1024, height: 1024 });
  const [resizeScale, setResizeScale] = useState(1);
  const [modelId, setModelId] = useState("sdxl_base");
  const [loraId, setLoraId] = useState("none");
  const [loraStrength, setLoraStrength] = useState(0.8);
  const [numImages, setNumImages] = useState(2);
  const [denoise, setDenoise] = useState(0.45);
  const [cfg, setCfg] = useState(5);
  const [steps, setSteps] = useState(25);
  const [results, setResults] = useState([]);
  const [libraryItems, setLibraryItems] = useState([]);
  const [libraryModalOpen, setLibraryModalOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [presets, setPresets] = useState([]);
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [error, setError] = useState("");
  const [job, setJob] = useState(EMPTY_JOB);
  const [jobId, setJobId] = useState("");

  useEffect(() => {
    setPresets(loadStoredPresets());
  }, []);

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

  function buildPresetPayload() {
    return {
      modelId,
      loraId,
      loraStrength,
      numImages,
      denoise,
      cfg,
      steps,
      resizeScale,
    };
  }

  function applyPreset(preset) {
    setModelId(preset.modelId || "sdxl_base");
    setLoraId(preset.loraId || "none");
    setLoraStrength(Number(preset.loraStrength ?? 0.8));
    setNumImages(Number(preset.numImages ?? 2));
    setDenoise(Number(preset.denoise ?? 0.45));
    setCfg(Number(preset.cfg ?? 5));
    setSteps(Number(preset.steps ?? 25));
    setResizeScale(Number(preset.resizeScale ?? 1));
  }

  function handlePresetSelect(event) {
    const nextId = event.target.value;
    setSelectedPresetId(nextId);
    const preset = presets.find((item) => item.id === nextId);
    if (!preset) return;
    setPresetName(preset.name);
    applyPreset(preset);
  }

  function handleSavePreset() {
    const name = presetName.trim();
    if (!name) {
      setError("Preset name required.");
      return;
    }

    const existing = presets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset = {
      id: existing?.id || crypto.randomUUID(),
      name,
      ...buildPresetPayload(),
    };
    const nextPresets = existing
      ? presets.map((item) => (item.id === existing.id ? nextPreset : item))
      : [nextPreset, ...presets];
    setPresets(nextPresets);
    setSelectedPresetId(nextPreset.id);
    saveStoredPresets(nextPresets);
    setError("");
  }

  function handleDeletePreset() {
    if (!selectedPresetId) return;
    const nextPresets = presets.filter((item) => item.id !== selectedPresetId);
    setPresets(nextPresets);
    saveStoredPresets(nextPresets);
    setSelectedPresetId("");
    setPresetName("");
  }

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
          lora_strength: Number(loraStrength),
          cfg: Number(cfg),
          steps: Number(steps),
          sampler: DEFAULT_SAMPLER,
          schedule: DEFAULT_SCHEDULE,
          scale: Number(resizeScale.toFixed(2)),
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

  async function deleteLibraryItem(itemId) {
    const response = await fetch(`${API_URL}/api/library/${itemId}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "Delete failed.");
    }
    setLibraryItems((current) => current.filter((item) => item.id !== itemId));
    if (selectedImage?.libraryId === itemId) {
      setSelectedImage(null);
    }
  }

  function openResultImage(image, index) {
    setSelectedImage({
      src: buildImageUrl(`data:image/${image.format || "png"};base64,${image.image_base64}`),
      width: image.width,
      height: image.height,
      downloadUrl: `data:image/${image.format || "png"};base64,${image.image_base64}`,
      filename: `img2img-output-${index + 1}.${image.format || "png"}`,
    });
  }

  function openLibraryImage(item) {
    setSelectedImage({
      src: buildImageUrl(item.url),
      width: item.width,
      height: item.height,
      downloadUrl: buildImageUrl(item.url),
      filename: item.filename || `img2img-library-${item.id}.png`,
      libraryId: item.id,
    });
  }

  function downloadDataImage(image, index) {
    const anchor = document.createElement("a");
    anchor.href = `data:image/${image.format || "png"};base64,${image.image_base64}`;
    anchor.download = `img2img-output-${index + 1}.${image.format || "png"}`;
    anchor.click();
  }

  function downloadLibraryImage(item) {
    const anchor = document.createElement("a");
    anchor.href = buildImageUrl(item.url);
    anchor.download = item.filename || `img2img-library-${item.id}.png`;
    anchor.click();
  }

  function downloadSelectedImage() {
    if (!selectedImage?.downloadUrl) return;
    const anchor = document.createElement("a");
    anchor.href = selectedImage.downloadUrl;
    anchor.download = selectedImage.filename || "img2img-output.png";
    anchor.click();
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
            {previewUrl ? (
              <span className="input-dimensions">
                {imageSize.width} x {imageSize.height}
              </span>
            ) : null}
          </label>
        </section>

        <FieldSelect label="MODEL" value={modelId} onChange={setModelId} options={models} />
        <FieldSelect label="LORA" value={loraId} onChange={setLoraId} options={loras} />

        <SliderField label="LORA STR" value={loraStrength.toFixed(2)}>
          <input
            type="range"
            min="0"
            max="2"
            step="0.01"
            value={loraStrength}
            onChange={(event) => setLoraStrength(Number(event.target.value))}
          />
        </SliderField>

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
            max="4"
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
                onClick={() => image && openResultImage(image, index)}
                disabled={!image}
              >
                <span className="frame-corner frame-corner-tl" />
                <span className="frame-corner frame-corner-tr" />
                <span className="frame-corner frame-corner-bl" />
                <span className="frame-corner frame-corner-br" />

                {image ? (
                  <>
                    <div className="output-image-shell">
                      <img src={imageSrc} alt={`Output ${index + 1}`} />
                    </div>
                    <button
                      type="button"
                      className="output-download"
                      onClick={(event) => {
                        event.stopPropagation();
                        downloadDataImage(image, index);
                      }}
                      aria-label={`Download output ${index + 1}`}
                    >
                      ↓
                    </button>
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

        <section className="control-group preset-group">
          <SectionTitle title="PRESETS" />
          <select value={selectedPresetId} onChange={handlePresetSelect}>
            <option value="">Select preset</option>
            {presets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <input
            className="preset-input"
            type="text"
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
            placeholder="Preset name"
          />
          <div className="preset-actions">
            <button type="button" className="preset-button" onClick={handleSavePreset}>
              SAVE
            </button>
            <button type="button" className="preset-button preset-button-danger" onClick={handleDeletePreset} disabled={!selectedPresetId}>
              DELETE
            </button>
          </div>
        </section>

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

        <section className="library-panel">
          <button type="button" className="library-toggle" onClick={() => setLibraryModalOpen(true)}>
            <span className="library-toggle-title">
              <span className="section-mark" />
              <span>LIBRARY</span>
            </span>
            <strong>{libraryItems.length}</strong>
          </button>
          <div className="library-grid">
            {libraryItems.length ? (
              libraryItems.map((item) => (
                <div key={item.id} className="library-card">
                  <button type="button" className="library-thumb" onClick={() => openLibraryImage(item)}>
                    <img src={buildImageUrl(item.url)} alt={item.filename} loading="lazy" />
                  </button>
                  <button
                    type="button"
                    className="library-download"
                    onClick={() => downloadLibraryImage(item)}
                    aria-label={`Download ${item.filename}`}
                  >
                    ↓
                  </button>
                </div>
              ))
            ) : (
              <div className="library-empty">NO IMAGES</div>
            )}
          </div>
        </section>
      </aside>

      {libraryModalOpen ? (
        <div className="library-modal" onClick={() => setLibraryModalOpen(false)}>
          <div className="library-modal-frame" onClick={(event) => event.stopPropagation()}>
            <div className="library-modal-head">
              <div className="library-modal-title">
                <span className="section-mark" />
                <strong>LIBRARY</strong>
              </div>
              <button type="button" className="library-modal-close" onClick={() => setLibraryModalOpen(false)}>
                CLOSE
              </button>
            </div>
            <div className="library-modal-grid">
              {libraryItems.length ? (
                libraryItems.map((item) => (
                  <div key={item.id} className="library-modal-card">
                    <button type="button" className="library-modal-thumb" onClick={() => openLibraryImage(item)}>
                      <img src={buildImageUrl(item.url)} alt={item.filename} loading="lazy" />
                    </button>
                    <div className="library-modal-actions">
                      <button type="button" className="library-modal-button" onClick={() => downloadLibraryImage(item)}>
                        ↓
                      </button>
                      <button
                        type="button"
                        className="library-modal-button library-modal-button-danger"
                        onClick={() => deleteLibraryItem(item.id).catch((deleteError) => setError(deleteError.message))}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="library-empty">NO IMAGES</div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {selectedImage ? (
        <div className="lightbox" onClick={() => setSelectedImage(null)}>
          <div className="lightbox-frame" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="lightbox-download" onClick={downloadSelectedImage} aria-label="Download image">
              ↓
            </button>
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

function formatTime(isoValue) {
  const value = new Date(isoValue);
  return value.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default App;
