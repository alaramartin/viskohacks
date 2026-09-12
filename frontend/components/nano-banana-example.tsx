"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import dogImage from "@/dog.png";
import { NANO_BANANA_PROMPT, ORBIS_KICKOFF_PROMPT } from "@/lib/nano-banana";

type NanoBananaExampleProps = {
  disabled: boolean;
  onActivityChange: (active: boolean) => void;
  onReady: (image: File, prompt: string) => Promise<void>;
};

type PipelineStage = "idle" | "editing" | "analyzing" | "starting";

function useObjectUrl(file: File | null) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!file) {
      setUrl("");
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  return url;
}

export function NanoBananaExample({
  disabled,
  onActivityChange,
  onReady,
}: NanoBananaExampleProps) {
  const [output, setOutput] = useState<File | null>(null);
  const [stage, setStage] = useState<PipelineStage>("idle");
  const [groundedPrompt, setGroundedPrompt] = useState("");
  const [error, setError] = useState("");
  const outputUrl = useObjectUrl(output);
  const busy = stage !== "idle";

  const editImage = async () => {
    setStage("editing");
    onActivityChange(true);
    setError("");
    setGroundedPrompt("");
    try {
      const sourceResponse = await fetch(dogImage.src);
      if (!sourceResponse.ok) throw new Error("Could not load dog.png");

      const formData = new FormData();
      formData.append("image", await sourceResponse.blob(), "dog.png");
      const response = await fetch("/api/nano-banana", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error || "Nano Banana image edit failed");
      }

      const blob = await response.blob();
      const extension = blob.type === "image/jpeg" ? "jpg" : "png";
      const editedImage = new File([blob], `nano-banana-output.${extension}`, {
        type: blob.type || "image/png",
      });
      setOutput(editedImage);

      setStage("analyzing");
      const analysisForm = new FormData();
      analysisForm.append("image", editedImage);
      analysisForm.append("prompt", ORBIS_KICKOFF_PROMPT);
      const analysisResponse = await fetch("/api/orbis-prompt", {
        method: "POST",
        body: analysisForm,
      });
      const analysis = (await analysisResponse.json()) as {
        prompt?: string;
        error?: string;
      };
      if (!analysisResponse.ok || !analysis.prompt?.trim()) {
        throw new Error(analysis.error || "Gemini returned no grounded prompt");
      }

      const nextPrompt = analysis.prompt.trim();
      setGroundedPrompt(nextPrompt);
      setStage("starting");
      await onReady(editedImage, nextPrompt);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setStage("idle");
      onActivityChange(false);
    }
  };

  return (
    <details className="nano-demo">
      <summary>Livestreaming example</summary>
      <div className="nano-demo-content">
        <p className="hint">
          Connect to Orbis, then run the complete example with one button. Nano
          Banana edits the bundled image, Gemini grounds the user prompt in that
          result, and Orbis starts streaming from the edited frame.
        </p>

        <div className="nano-preview-grid">
          <figure className="nano-preview">
            <div className="nano-image-frame">
              <Image
                src={dogImage}
                alt="Golden retriever source image"
                fill
                sizes="(max-width: 800px) 100vw, 50vw"
              />
            </div>
            <figcaption>Source: dog.png</figcaption>
          </figure>

          <figure className="nano-preview">
            <div className="nano-image-frame">
              {outputUrl ? (
                <img src={outputUrl} alt="Nano Banana edited output" />
              ) : (
                <span className="nano-output-placeholder">
                  {busy ? "Editing image…" : "Nano Banana output"}
                </span>
              )}
            </div>
            <figcaption>Output · Orbis start image</figcaption>
          </figure>
        </div>

        <div className="preset-prompt">
          <strong>User prompt</strong>
          <p>{ORBIS_KICKOFF_PROMPT}</p>
        </div>

        <div className="preset-prompt">
          <strong>Nano Banana prompt</strong>
          <p>{NANO_BANANA_PROMPT}</p>
        </div>

        <div className="preset-prompt">
          <strong>Gemini-grounded Orbis prompt</strong>
          <p>
            {groundedPrompt || "Generated after analyzing the edited image."}
          </p>
        </div>

        <button type="button" disabled={disabled || busy} onClick={editImage}>
          {stage === "editing" && "Editing image…"}
          {stage === "analyzing" && "Analyzing image and prompt…"}
          {stage === "starting" && "Starting stream…"}
          {stage === "idle" && "Edit and start stream"}
        </button>

        {error && <p className="error">{error}</p>}
      </div>
    </details>
  );
}
