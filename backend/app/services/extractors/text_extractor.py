"""OCR-based text extraction and label classification for floor plans."""

from __future__ import annotations

import re

import cv2
import numpy as np
import pytesseract


class TextExtractor:
    """Extracts text labels from floor plan images using Tesseract OCR.

    Detected text regions are classified as room names, dimension
    annotations, or uncategorised labels.  Labels can then be matched
    to room contours by spatial containment.
    """

    ROOM_TYPE_KEYWORDS: set[str] = {
        "bedroom", "bathroom", "kitchen", "living", "dining", "office",
        "closet", "garage", "basement", "attic", "hallway", "corridor",
        "lobby", "ballroom", "conference", "meeting", "storage", "utility",
        "mechanical", "electrical", "restroom", "lounge", "library",
        "chapel", "sanctuary", "gym", "pool", "stage", "auditorium",
    }

    _DIMENSION_PATTERN: re.Pattern[str] = re.compile(
        r"^\d+['\"]?\s*[xX\u00d7]\s*\d+['\"]?$|^\d+['\"]?\s*$"
    )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def extract_text_regions(self, image: np.ndarray) -> list[dict]:
        """Extract text with bounding boxes from a floor plan image.

        Returns:
            List of dicts with keys:
                ``text``, ``x``, ``y``, ``width``, ``height``, ``confidence``.
        """
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image

        # Denoise to improve OCR accuracy
        denoised = cv2.fastNlMeansDenoising(gray, h=10)

        data = pytesseract.image_to_data(denoised, output_type=pytesseract.Output.DICT)

        results: list[dict] = []
        n_words = len(data["text"])
        for i in range(n_words):
            text = data["text"][i].strip()
            conf = int(data["conf"][i])
            if text and conf > 30 and len(text) > 1:
                results.append({
                    "text": text,
                    "x": data["left"][i],
                    "y": data["top"][i],
                    "width": data["width"][i],
                    "height": data["height"][i],
                    "confidence": conf,
                })

        return results

    def classify_labels(self, text_regions: list[dict]) -> list[dict]:
        """Classify extracted text as room names, dimensions, or other.

        Mutates each dict in *text_regions* by adding a ``label_type``
        key with one of: ``'room_name'``, ``'dimension'``, ``'other'``.
        """
        for region in text_regions:
            text_lower = region["text"].lower()

            if any(kw in text_lower for kw in self.ROOM_TYPE_KEYWORDS):
                region["label_type"] = "room_name"
            elif self._DIMENSION_PATTERN.match(region["text"]):
                region["label_type"] = "dimension"
            else:
                region["label_type"] = "other"

        return text_regions

    def match_labels_to_rooms(
        self,
        labels: list[dict],
        room_contours: list[np.ndarray],
    ) -> dict[int, list[dict]]:
        """Match text labels to rooms by spatial containment.

        A label is matched to the first room contour whose polygon
        contains the label's centre point.

        Returns:
            Dict mapping room index (position in *room_contours*) to
            its list of matched label dicts.
        """
        matches: dict[int, list[dict]] = {}

        for label in labels:
            cx = label["x"] + label["width"] // 2
            cy = label["y"] + label["height"] // 2

            for idx, cnt in enumerate(room_contours):
                if cv2.pointPolygonTest(cnt, (float(cx), float(cy)), False) >= 0:
                    matches.setdefault(idx, []).append(label)
                    break

        return matches
