import * as faceapi from '@vladmandic/face-api';

const MODEL_URL = '/models';

let modelsLoaded = false;

export async function loadModels() {
  if (modelsLoaded) return;
  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);
  modelsLoaded = true;
}

/**
 * Detect a single face in a video/canvas element and return its 128-D descriptor.
 * Returns null if no face or multiple faces detected.
 */
export async function detectSingleFaceDescriptor(mediaElement) {
  const detection = await faceapi
    .detectSingleFace(mediaElement, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  return detection ?? null;
}

/**
 * Given an array of { label, descriptors[] } objects, build a FaceMatcher.
 * Each employee's stored descriptor (Float32Array) should be passed here.
 */
export function buildMatcher(labeledDescriptors, threshold = 0.5) {
  if (!labeledDescriptors.length) return null;
  const labeled = labeledDescriptors.map(
    ({ label, descriptors }) =>
      new faceapi.LabeledFaceDescriptors(
        label,
        descriptors.map((d) => new Float32Array(d))
      )
  );
  return new faceapi.FaceMatcher(labeled, threshold);
}

/**
 * Convert a Float32Array descriptor to a plain Array for JSON storage.
 */
export function descriptorToArray(descriptor) {
  return Array.from(descriptor);
}

/**
 * Detect a single face with landmarks only (no descriptor) — faster, for liveness checks.
 * Returns null if no face detected.
 */
export async function detectFaceWithLandmarks(mediaElement) {
  const result = await faceapi
    .detectSingleFace(mediaElement, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks();
  return result ?? null;
}

/**
 * Calculate the average Eye Aspect Ratio (EAR) from face landmarks.
 * EAR < 0.20 → eye closed (blink); EAR > 0.25 → eye open.
 */
export function calcEAR(landmarks) {
  function eyeAR(eye) {
    const d = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    return (d(eye[1], eye[5]) + d(eye[2], eye[4])) / (2 * d(eye[0], eye[3]));
  }
  return (eyeAR(landmarks.getLeftEye()) + eyeAR(landmarks.getRightEye())) / 2;
}

/**
 * Draw detection results on a canvas overlaid on a video element.
 */
export function drawDetections(canvas, videoEl, detections) {
  const dims = faceapi.matchDimensions(canvas, videoEl, true);
  const resized = faceapi.resizeResults(detections, dims);
  faceapi.draw.drawDetections(canvas, resized);
  faceapi.draw.drawFaceLandmarks(canvas, resized);
}
