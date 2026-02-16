"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type CameraPlatformCaptions = {
  masterCaption: string;
  facebookCaption: string;
  instagramCaption: string;
  twitterCaption: string;
  googleCaption: string;
  tiktokHook: string;
  snapchatText: string;
};

type CameraAnalyzeResponse = {
  sceneDescription?: string;
  captionIdea?: string;
  platformCaptions?: Partial<CameraPlatformCaptions>;
  signText?: string;
  camera?: {
    sceneDescription?: string;
    captionIdea?: string;
    platformCaptions?: Partial<CameraPlatformCaptions>;
    signText?: string;
  };
  analysis?: {
    captionRewrite?: string;
  };
  error?: string;
};

type ChannelState = {
  facebook: boolean;
  instagram: boolean;
  google: boolean;
  x: boolean;
  tiktok: boolean;
  snapchat: boolean;
};

const DEFAULT_CHANNELS: ChannelState = {
  facebook: true,
  instagram: true,
  google: true,
  x: true,
  tiktok: false,
  snapchat: false,
};

const EMPTY_PLATFORM_CAPTIONS: CameraPlatformCaptions = {
  masterCaption: "",
  facebookCaption: "",
  instagramCaption: "",
  twitterCaption: "",
  googleCaption: "",
  tiktokHook: "",
  snapchatText: "",
};

function withQuery(path: string, input: { brandId: string; locationId?: string }): string {
  const params = new URLSearchParams();
  if (input.brandId) {
    params.set("brandId", input.brandId);
  }
  if (input.locationId) {
    params.set("locationId", input.locationId);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function safeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePlatformCaptions(value: Partial<CameraPlatformCaptions> | undefined): CameraPlatformCaptions {
  const parsed = value ?? {};
  return {
    masterCaption: safeText(parsed.masterCaption),
    facebookCaption: safeText(parsed.facebookCaption),
    instagramCaption: safeText(parsed.instagramCaption),
    twitterCaption: safeText(parsed.twitterCaption),
    googleCaption: safeText(parsed.googleCaption),
    tiktokHook: safeText(parsed.tiktokHook),
    snapchatText: safeText(parsed.snapchatText),
  };
}

async function enhanceImageNatural(file: File): Promise<File> {
  if (typeof window === "undefined" || !file.type.startsWith("image/")) {
    return file;
  }
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    return file;
  }
  const targetSize = Math.max(1, Math.min(bitmap.width, bitmap.height));
  const sx = Math.max(0, Math.floor((bitmap.width - targetSize) / 2));
  const sy = Math.max(0, Math.floor((bitmap.height - targetSize) / 2));
  const canvas = document.createElement("canvas");
  canvas.width = targetSize;
  canvas.height = targetSize;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return file;
  }
  // Lightweight enhancement: normalize brightness + subtle contrast + center crop.
  context.filter = "brightness(1.05) contrast(1.08)";
  context.drawImage(bitmap, sx, sy, targetSize, targetSize, 0, 0, targetSize, targetSize);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.92);
  });
  if (!blob) {
    return file;
  }
  const baseName = file.name.replace(/\.[^./]+$/, "");
  return new File([blob], `${baseName}-camera.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

export default function CameraModePage() {
  const searchParams = useSearchParams();
  const brandId = useMemo(() => searchParams.get("brandId")?.trim() ?? "", [searchParams]);
  const locationId = useMemo(
    () => searchParams.get("locationId")?.trim() || undefined,
    [searchParams],
  );

  const uploadUrlEndpoint = useMemo(
    () => withQuery("/api/media/upload-url", { brandId, locationId }),
    [brandId, locationId],
  );
  const analyzeEndpoint = useMemo(
    () => withQuery("/api/media/analyze", { brandId, locationId }),
    [brandId, locationId],
  );
  const autopublicityEndpoint = useMemo(
    () => withQuery("/api/autopublicity", { brandId, locationId }),
    [brandId, locationId],
  );

  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const [mode, setMode] = useState<"photo" | "video">("photo");
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [previewType, setPreviewType] = useState<"image" | "video">("image");
  const [mediaUrl, setMediaUrl] = useState<string>("");
  const [sceneDescription, setSceneDescription] = useState<string>("");
  const [captionIdea, setCaptionIdea] = useState<string>("");
  const [signText, setSignText] = useState<string>("");
  const [platformCaptions, setPlatformCaptions] = useState<CameraPlatformCaptions>(EMPTY_PLATFORM_CAPTIONS);
  const [channels, setChannels] = useState<ChannelState>(DEFAULT_CHANNELS);
  const [busy, setBusy] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("");
  const [postStatus, setPostStatus] = useState<string>("");
  const [openReadyLinks, setOpenReadyLinks] = useState<{
    tiktok?: { text: string; url: string };
    snapchat?: { text: string; url: string };
  }>({});
  const [ownerMomentum, setOwnerMomentum] = useState<{
    level?: string;
    line?: string;
  }>({});

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const hasReview = Boolean(mediaUrl && captionIdea);

  async function uploadCapturedFile(file: File, kind: "image" | "video"): Promise<string> {
    const signedResponse = await fetch(uploadUrlEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name || `camera-${Date.now()}`,
        contentType: file.type || "application/octet-stream",
        kind,
      }),
    });
    const signedJson = (await signedResponse.json().catch(() => ({}))) as {
      signedUrl?: string;
      publicUrl?: string;
      error?: string;
    };
    if (!signedResponse.ok || !signedJson.signedUrl || !signedJson.publicUrl) {
      throw new Error(signedJson.error || "Upload setup failed.");
    }
    const putResponse = await fetch(signedJson.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!putResponse.ok) {
      throw new Error("Upload failed.");
    }
    return signedJson.publicUrl;
  }

  async function analyzeForCamera(input: {
    uploadedMediaUrl: string;
    mediaKind: "image" | "video";
    contextHint?: string;
  }): Promise<void> {
    const analyzeResponse = await fetch(analyzeEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageUrl: input.uploadedMediaUrl,
        mediaKind: input.mediaKind,
        platform: "instagram",
        goals: ["repeat_customers"],
        imageContext: input.contextHint ?? "Fresh camera capture",
        cameraMode: true,
      }),
    });
    const payload = (await analyzeResponse.json().catch(() => ({}))) as CameraAnalyzeResponse;
    if (!analyzeResponse.ok) {
      throw new Error(payload.error || "Could not analyze media.");
    }

    const cameraPayload = payload.camera ?? {};
    const scene = safeText(payload.sceneDescription) || safeText(cameraPayload.sceneDescription);
    const idea =
      safeText(payload.captionIdea) ||
      safeText(cameraPayload.captionIdea) ||
      safeText(payload.analysis?.captionRewrite) ||
      "Fresh local update from camera mode.";
    const sign = safeText(payload.signText) || safeText(cameraPayload.signText);
    const captions = normalizePlatformCaptions(payload.platformCaptions ?? cameraPayload.platformCaptions);
    const mergedCaptions: CameraPlatformCaptions = {
      ...captions,
      masterCaption: captions.masterCaption || idea,
      facebookCaption: captions.facebookCaption || idea,
      instagramCaption: captions.instagramCaption || idea,
      twitterCaption: captions.twitterCaption || idea,
      googleCaption: captions.googleCaption || idea,
      tiktokHook: captions.tiktokHook || idea,
      snapchatText: captions.snapchatText || idea,
    };

    setSceneDescription(scene);
    setCaptionIdea(idea);
    setSignText(sign);
    setPlatformCaptions(mergedCaptions);
  }

  async function onCapturedFile(file: File | undefined): Promise<void> {
    if (!file) {
      return;
    }
    if (!brandId) {
      setStatus("Missing brandId. Open Camera Mode from your app home button.");
      return;
    }
    setBusy(true);
    setPostStatus("");
    setOwnerMomentum({});
    setOpenReadyLinks({});
    try {
      const isPhoto = file.type.startsWith("image/");
      const mediaKind: "image" | "video" = isPhoto ? "image" : "video";
      setPreviewType(isPhoto ? "image" : "video");
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      setPreviewUrl(URL.createObjectURL(file));

      setStatus(isPhoto ? "Applying natural camera adjustments..." : "Preparing video...");
      const preparedFile = isPhoto ? await enhanceImageNatural(file) : file;

      setStatus("Uploading...");
      const uploadedMediaUrl = await uploadCapturedFile(preparedFile, mediaKind);
      setMediaUrl(uploadedMediaUrl);

      setStatus("Generating local captions...");
      await analyzeForCamera({
        uploadedMediaUrl,
        mediaKind,
      });
      setStatus("Review looks good. Post when ready.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Camera flow failed.";
      setStatus(message);
    } finally {
      setBusy(false);
    }
  }

  async function postNow(): Promise<void> {
    if (!mediaUrl) {
      setPostStatus("Capture media first.");
      return;
    }
    if (!brandId) {
      setPostStatus("Missing brandId. Open Camera Mode from your app home button.");
      return;
    }
    setBusy(true);
    setPostStatus("Posting now...");
    try {
      const response = await fetch(autopublicityEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaUrl,
          captionIdea,
          channels,
          confirmPost: true,
          cameraMode: true,
          locationId,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        ownerConfidence?: {
          level?: string;
          line?: string;
        };
        openReady?: {
          tiktok?: { enabled?: boolean; text?: string; openUrl?: string };
          snapchat?: { enabled?: boolean; text?: string; openUrl?: string };
        };
      };
      if (!response.ok) {
        throw new Error(payload.error || "Could not post right now.");
      }
      const nextOpenReady: {
        tiktok?: { text: string; url: string };
        snapchat?: { text: string; url: string };
      } = {};
      if (payload.openReady?.tiktok?.enabled && payload.openReady.tiktok.openUrl) {
        nextOpenReady.tiktok = {
          text: payload.openReady.tiktok.text || platformCaptions.tiktokHook,
          url: payload.openReady.tiktok.openUrl,
        };
      }
      if (payload.openReady?.snapchat?.enabled && payload.openReady.snapchat.openUrl) {
        nextOpenReady.snapchat = {
          text: payload.openReady.snapchat.text || platformCaptions.snapchatText,
          url: payload.openReady.snapchat.openUrl,
        };
      }
      setOpenReadyLinks(nextOpenReady);
      setOwnerMomentum({
        level: payload.ownerConfidence?.level,
        line: payload.ownerConfidence?.line,
      });
      setPostStatus(payload.message || "Posted.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not post.";
      setPostStatus(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: "#0f172a", color: "#ffffff", padding: "12px" }}>
      <section
        style={{
          minHeight: hasReview ? "auto" : "calc(100vh - 24px)",
          borderRadius: 20,
          background: "#111827",
          border: "1px solid #1f2937",
          padding: 16,
          display: "grid",
          gap: 14,
        }}
      >
        <div style={{ display: "grid", gap: 6 }}>
          <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9ca3af" }}>
            Camera Mode
          </p>
          <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.25 }}>Snap → AI → Share Together</h1>
          <p style={{ margin: 0, color: "#d1d5db" }}>Capture and post in seconds. No editing complexity.</p>
        </div>

        <div
          style={{
            borderRadius: 16,
            border: "1px solid #374151",
            background: "#020617",
            minHeight: 320,
            display: "grid",
            placeItems: "center",
            overflow: "hidden",
          }}
        >
          {previewUrl ? (
            previewType === "image" ? (
              <img src={previewUrl} alt="Camera preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <video src={previewUrl} controls playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            )
          ) : (
            <p style={{ color: "#9ca3af", margin: 0, textAlign: "center", padding: 24 }}>
              Full-screen camera capture opens on shutter tap.
            </p>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 8,
            background: "#0b1220",
            border: "1px solid #1f2937",
            borderRadius: 999,
            padding: 6,
            width: "fit-content",
            margin: "0 auto",
          }}
        >
          <button
            type="button"
            onClick={() => setMode("photo")}
            style={{
              border: "none",
              borderRadius: 999,
              padding: "8px 16px",
              fontWeight: 600,
              background: mode === "photo" ? "#1F4E79" : "transparent",
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            Photo
          </button>
          <button
            type="button"
            onClick={() => setMode("video")}
            style={{
              border: "none",
              borderRadius: 999,
              padding: "8px 16px",
              fontWeight: 600,
              background: mode === "video" ? "#1F4E79" : "transparent",
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            Video
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "center" }}>
          <button
            type="button"
            onClick={() => (mode === "photo" ? photoInputRef.current?.click() : videoInputRef.current?.click())}
            disabled={busy}
            style={{
              width: 94,
              height: 94,
              borderRadius: "50%",
              border: "4px solid #e5e7eb",
              background: busy ? "#9ca3af" : "#ffffff",
              color: "#0f172a",
              fontSize: 14,
              fontWeight: 700,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "..." : "Shutter"}
          </button>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={(event) => {
              void onCapturedFile(event.target.files?.[0]);
            }}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={(event) => {
              void onCapturedFile(event.target.files?.[0]);
            }}
          />
        </div>

        <p style={{ margin: 0, color: "#cbd5e1", textAlign: "center", minHeight: 22 }}>{status || "Ready when you are."}</p>

        {hasReview ? (
          <section
            style={{
              borderRadius: 16,
              background: "#ffffff",
              color: "#111827",
              padding: 14,
              display: "grid",
              gap: 10,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 20 }}>Quick Review</h2>
            {sceneDescription ? <p style={{ margin: 0, color: "#4b5563" }}>{sceneDescription}</p> : null}
            <label style={{ display: "grid", gap: 6, fontSize: 14, color: "#374151" }}>
              Caption (editable)
              <textarea
                value={captionIdea}
                onChange={(event) => setCaptionIdea(event.target.value)}
                rows={3}
                style={{ width: "100%", borderRadius: 12, border: "1px solid #d1d5db", padding: 10 }}
              />
            </label>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 10, display: "grid", gap: 8 }}>
              <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b7280" }}>
                Platforms
              </p>
              {(
                [
                  ["facebook", "Facebook"],
                  ["instagram", "Instagram"],
                  ["google", "Google"],
                  ["x", "X"],
                  ["tiktok", "TikTok (Open Ready)"],
                  ["snapchat", "Snapchat (Open Ready)"],
                ] as Array<[keyof ChannelState, string]>
              ).map(([key, label]) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={channels[key]}
                    onChange={(event) =>
                      setChannels((current) => ({
                        ...current,
                        [key]: event.target.checked,
                      }))
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                void postNow();
              }}
              disabled={busy}
              style={{
                border: "none",
                borderRadius: 14,
                background: "#1F4E79",
                color: "#ffffff",
                padding: "14px 16px",
                fontSize: 18,
                fontWeight: 700,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              Post Now
            </button>
            <button
              type="button"
              onClick={() => {
                setMediaUrl("");
                setCaptionIdea("");
                setSceneDescription("");
                setSignText("");
                setPlatformCaptions(EMPTY_PLATFORM_CAPTIONS);
                setPostStatus("");
                setOpenReadyLinks({});
              }}
              style={{
                borderRadius: 12,
                border: "1px solid #d1d5db",
                background: "#ffffff",
                color: "#111827",
                padding: "10px 12px",
                fontWeight: 600,
              }}
            >
              Retake
            </button>
            {postStatus ? <p style={{ margin: 0, color: "#374151" }}>{postStatus}</p> : null}
            {ownerMomentum.level ? (
              <p style={{ margin: 0, color: "#1f4e79" }}>
                Momentum: {ownerMomentum.level} {ownerMomentum.line ? `- ${ownerMomentum.line}` : ""}
              </p>
            ) : null}
            {openReadyLinks.tiktok || openReadyLinks.snapchat ? (
              <div style={{ display: "grid", gap: 8, borderTop: "1px solid #e5e7eb", paddingTop: 10 }}>
                <p style={{ margin: 0, color: "#374151", fontWeight: 600 }}>Open Ready</p>
                {openReadyLinks.tiktok ? (
                  <a href={openReadyLinks.tiktok.url} target="_blank" rel="noopener noreferrer" style={{ color: "#1F4E79" }}>
                    Open TikTok - {openReadyLinks.tiktok.text}
                  </a>
                ) : null}
                {openReadyLinks.snapchat ? (
                  <a href={openReadyLinks.snapchat.url} target="_blank" rel="noopener noreferrer" style={{ color: "#1F4E79" }}>
                    Open Snapchat - {openReadyLinks.snapchat.text}
                  </a>
                ) : null}
              </div>
            ) : null}
            <details>
              <summary style={{ cursor: "pointer" }}>Generated platform captions</summary>
              <div style={{ display: "grid", gap: 6, marginTop: 8, color: "#374151" }}>
                <p style={{ margin: 0 }}><strong>Facebook:</strong> {platformCaptions.facebookCaption || "-"}</p>
                <p style={{ margin: 0 }}><strong>Instagram:</strong> {platformCaptions.instagramCaption || "-"}</p>
                <p style={{ margin: 0 }}><strong>Google:</strong> {platformCaptions.googleCaption || "-"}</p>
                <p style={{ margin: 0 }}><strong>X:</strong> {platformCaptions.twitterCaption || "-"}</p>
                <p style={{ margin: 0 }}><strong>TikTok Hook:</strong> {platformCaptions.tiktokHook || "-"}</p>
                <p style={{ margin: 0 }}><strong>Snapchat Text:</strong> {platformCaptions.snapchatText || "-"}</p>
                {signText ? <p style={{ margin: 0 }}><strong>Sign Text:</strong> {signText}</p> : null}
              </div>
            </details>
          </section>
        ) : null}
      </section>
    </main>
  );
}
