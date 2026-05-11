import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";

const QUALITY_OPTIONS = [
  { id: "fast", label: "Fast" },
  { id: "balanced", label: "Balanced" },
  { id: "high", label: "High" },
  { id: "maximum", label: "Maximum" },
];

const SCALE_OPTIONS = [
  { label: "100%", value: 1 },
  { label: "125%", value: 1.25 },
  { label: "150%", value: 1.5 },
  { label: "200%", value: 2 },
];

const DEFAULT_MODELS = [
  { id: "sdxl_base", name: "SDXL Base" },
  { id: "custom_1", name: "Custom Model 1" },
  { id: "custom_2", name: "Custom Model 2" },
  { id: "custom_3", name: "Custom Model 3" },
];

const DEFAULT_LORAS = [
  { id: "none", name: "No LoRA" },
  { id: "lora_1", name: "LoRA 1" },
  { id: "lora_2", name: "LoRA 2" },
  { id: "lora_3", name: "LoRA 3" },
  { id: "lora_4", name: "LoRA 4" },
  { id: "lora_5", name: "LoRA 5" },
];

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function App() {
  const [models, setModels] = useState(DEFAULT_MODELS);
  const [loras, setLoras] = useState(DEFAULT_LORAS);
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [modelId, setModelId] = useState("sdxl_base");
  const [loraId, setLoraId] = useState("none");
  const [denoise, setDenoise] = useState(0.35);
  const [loraStrength, setLoraStrength] = useState(0.8);
  const [quality, setQuality] = useState("balanced");
  const [scale, setScale] = useState(1);
  const [numImages, setNumImages] = useState(1);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/options`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.models?.length) setModels(data.models);
        if (data?.loras?.length) setLoras(data.loras);
      })
      .catch(() => {});
  }, []);

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setResults([]);
    setError("");
  }

  async function handleGenerate() {
    if (!imageFile) {
      setError("Upload image first.");
      return;
    }

    setIsGenerating(true);
    setError("");

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
          quality,
          scale: Number(scale),
          num_images: Number(numImages),
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Generation failed.");
      setResults(data.images || []);
    } catch (generationError) {
      setError(generationError.message);
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark" />
          <span>Img2Style</span>
        </div>
        <span className="endpoint">RunPod Serverless</span>
      </header>

      <section className="workbench">
        <div className="input-panel panel">
          <div className="panel-head">
            <h1>Input</h1>
            <span>{imageFile?.name || "No file"}</span>
          </div>

          <label className="dropzone">
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} />
            {previewUrl ? <img src={previewUrl} alt="Input" /> : <span>Upload image</span>}
          </label>
        </div>

        <aside className="settings-panel panel">
          <div className="panel-head">
            <h1>Settings</h1>
          </div>

          <Field label="Model">
            <select value={modelId} onChange={(event) => setModelId(event.target.value)}>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="LoRA">
            <select value={loraId} onChange={(event) => setLoraId(event.target.value)}>
              {loras.map((lora) => (
                <option key={lora.id} value={lora.id}>
                  {lora.name}
                </option>
              ))}
            </select>
          </Field>

          <Slider label="Denoise" value={denoise} min="0.05" max="1" step="0.01" onChange={setDenoise} />
          <Slider label="LoRA strength" value={loraStrength} min="0" max="2" step="0.05" onChange={setLoraStrength} />
          <Segmented label="Quality" value={quality} options={QUALITY_OPTIONS} onChange={setQuality} />
          <Segmented label="Scale" value={scale} options={SCALE_OPTIONS} onChange={setScale} />

          <Field label="Images">
            <select value={numImages} onChange={(event) => setNumImages(event.target.value)}>
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>

          {error && <div className="error">{error}</div>}

          <button className="generate" disabled={isGenerating || !imageFile} onClick={handleGenerate}>
            {isGenerating ? "Generating" : "Generate"}
          </button>
        </aside>
      </section>

      <section className="results panel">
        <div className="panel-head">
          <h1>Results</h1>
          <span>{results.length}</span>
        </div>

        {results.length ? (
          <div className="gallery">
            {results.map((image, index) => (
              <article className="result" key={`${image.width}-${image.height}-${index}`}>
                <img src={`data:image/${image.format || "png"};base64,${image.image_base64}`} alt={`Output ${index + 1}`} />
                <span>
                  {image.width} x {image.height}
                </span>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty">No results</div>
        )}
      </section>
    </main>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Slider({ label, value, min, max, step, onChange }) {
  return (
    <label className="field">
      <span>
        {label}
        <strong>{Number(value).toFixed(2)}</strong>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="segmented">
        {options.map((option) => {
          const optionValue = option.value ?? option.id;
          return (
            <button
              key={option.label}
              type="button"
              className={String(value) === String(optionValue) ? "active" : ""}
              onClick={() => onChange(optionValue)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default App;
