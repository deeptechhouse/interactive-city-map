"""Binary image classifier: is this image a floor plan or not?

Uses a feature-based approach with scikit-learn SVM.  Features
include edge density, Hough line statistics, colour variance,
white-space ratio, connected-component density, and a text-region
proxy.

When no pre-trained model is available on disk, a deterministic
heuristic fallback produces reasonable predictions.
"""

from __future__ import annotations

import pickle
from pathlib import Path

import cv2
import numpy as np


class FloorPlanClassifier:
    """Classifies images as floor plans or non-floor-plans."""

    MODEL_PATH: Path = (
        Path(__file__).parent.parent / "data_import" / "interior" / "classifier_model.pkl"
    )

    _N_FEATURES: int = 10

    def __init__(self) -> None:
        self._model = None

    # ------------------------------------------------------------------
    # Model persistence
    # ------------------------------------------------------------------

    def load_model(self) -> bool:
        """Load a pre-trained model from disk.

        Returns:
            ``True`` if a model was loaded successfully.
        """
        if self.MODEL_PATH.exists():
            with open(self.MODEL_PATH, "rb") as fh:
                self._model = pickle.load(fh)  # noqa: S301
            return True
        return False

    # ------------------------------------------------------------------
    # Feature extraction
    # ------------------------------------------------------------------

    def extract_features(self, image_data: bytes) -> np.ndarray:
        """Extract a fixed-length feature vector from raw image bytes.

        Returns:
            1-D numpy array of length :attr:`_N_FEATURES`.
        """
        nparr = np.frombuffer(image_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return np.zeros(self._N_FEATURES)

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape
        total_pixels = h * w

        # 1. Edge density
        edges = cv2.Canny(gray, 50, 150)
        edge_density = np.count_nonzero(edges) / total_pixels

        # 2 & 3. Line statistics
        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, 50, minLineLength=30, maxLineGap=10)
        line_count = len(lines) if lines is not None else 0
        line_density = line_count / max(total_pixels / 10_000, 1)

        h_lines = 0
        v_lines = 0
        if lines is not None:
            for line in lines:
                x1, y1, x2, y2 = line[0]
                angle = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
                if angle < 15 or angle > 165:
                    h_lines += 1
                elif 75 < angle < 105:
                    v_lines += 1
            hv_ratio = (h_lines + v_lines) / max(line_count, 1)
        else:
            hv_ratio = 0.0

        # 4. Aspect ratio
        aspect_ratio = w / max(h, 1)

        # 5. White-space ratio (floor plans have large white areas)
        white_ratio = np.count_nonzero(gray > 200) / total_pixels

        # 6. Colour saturation statistics
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        sat_mean = float(np.mean(hsv[:, :, 1]))
        sat_std = float(np.std(hsv[:, :, 1]))

        # 7. Connected-component density
        _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)
        n_components, _ = cv2.connectedComponents(binary)
        component_density = n_components / max(total_pixels / 10_000, 1)

        # 8. Text-region proxy (small contour ratio)
        _, binary_inv = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        contours, _ = cv2.findContours(binary_inv, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        small_contours = sum(1 for c in contours if 10 < cv2.contourArea(c) < 500)
        text_proxy = small_contours / max(len(contours), 1)

        return np.array([
            edge_density,
            line_density,
            hv_ratio,
            aspect_ratio,
            white_ratio,
            sat_mean / 255.0,
            sat_std / 255.0,
            component_density,
            text_proxy,
            line_count / 100.0,
        ])

    # ------------------------------------------------------------------
    # Prediction
    # ------------------------------------------------------------------

    def predict(self, image_data: bytes) -> tuple[bool, float]:
        """Predict whether an image is a floor plan.

        Returns:
            ``(is_floor_plan, confidence)`` where confidence is in ``[0, 1]``.
        """
        features = self.extract_features(image_data).reshape(1, -1)

        if self._model is not None:
            proba = self._model.predict_proba(features)[0]
            is_fp = bool(proba[1] > 0.5)
            confidence = float(proba[1])
            return is_fp, confidence

        # Deterministic heuristic fallback
        return self._heuristic_predict(features[0])

    # ------------------------------------------------------------------
    # Training
    # ------------------------------------------------------------------

    def train(
        self,
        image_data_list: list[bytes],
        labels: list[int],
        save: bool = True,
    ) -> float:
        """Train the classifier on labelled data.

        Args:
            image_data_list: List of raw image bytes.
            labels: Parallel list of ``0`` (not floor plan) or ``1``
                (floor plan).
            save: Whether to persist the trained model to
                :attr:`MODEL_PATH`.

        Returns:
            Mean 5-fold cross-validation accuracy.
        """
        from sklearn.model_selection import cross_val_score
        from sklearn.pipeline import make_pipeline
        from sklearn.preprocessing import StandardScaler
        from sklearn.svm import SVC

        features = np.array([self.extract_features(img) for img in image_data_list])
        labels_arr = np.array(labels)

        pipeline = make_pipeline(StandardScaler(), SVC(kernel="rbf", probability=True))

        scores = cross_val_score(pipeline, features, labels_arr, cv=5, scoring="accuracy")

        # Final model trained on all data
        pipeline.fit(features, labels_arr)
        self._model = pipeline

        if save:
            self.MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(self.MODEL_PATH, "wb") as fh:
                pickle.dump(pipeline, fh)

        return float(scores.mean())

    # ------------------------------------------------------------------
    # Heuristic fallback
    # ------------------------------------------------------------------

    @staticmethod
    def _heuristic_predict(features: np.ndarray) -> tuple[bool, float]:
        """Rule-based prediction when no trained model is available."""
        edge_density = features[0]
        line_density = features[1]
        hv_ratio = features[2]
        white_ratio = features[4]
        sat_mean = features[5]
        line_count_norm = features[9]

        score = 0.0
        if edge_density > 0.05:
            score += 0.2
        if line_density > 0.5:
            score += 0.2
        if hv_ratio > 0.5:
            score += 0.2
        if white_ratio > 0.3:
            score += 0.1
        if sat_mean < 0.3:
            score += 0.1
        if line_count_norm > 0.2:
            score += 0.2

        return score > 0.5, score
