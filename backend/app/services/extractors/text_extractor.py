"""OCR-based text extraction and label classification for floor plans."""

from __future__ import annotations

import re

import cv2
import numpy as np
import pytesseract
import shapely  # vectorised geometry constructors (box, points)
from shapely import STRtree  # R-tree: O(log n + k) "which boxes contain this point" queries


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

    # O(P + w) time, O(P + w) space — P = image pixels (denoise + OCR); w = words OCR returned
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
        # O(w) time, O(w) space — w = words OCR returned
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

    # O(S) time, O(1) space — S = total characters across text regions; k = 29 fixed keywords
    def classify_labels(self, text_regions: list[dict]) -> list[dict]:
        """Classify extracted text as room names, dimensions, or other.

        Mutates each dict in *text_regions* by adding a ``label_type``
        key with one of: ``'room_name'``, ``'dimension'``, ``'other'``.
        """
        # O(S) time, O(1) space — S = total characters across text regions; k = 29 fixed keywords
        for region in text_regions:
            text_lower = region["text"].lower()

            # O(s) time, O(1) space — s = characters in this region (sums to S); k = 29 fixed keywords
            # bigo-lint: disable=BIGO006 — amortised: per-region character work sums to S
            if any(kw in text_lower for kw in self.ROOM_TYPE_KEYWORDS):
                region["label_type"] = "room_name"
            elif self._DIMENSION_PATTERN.match(region["text"]):
                region["label_type"] = "dimension"
            else:
                region["label_type"] = "other"

        return text_regions

    # O(V + T log R + K) time, O(R + T) space — V = total contour vertices; T = labels; R = room contours; K = vertex work of point-in-polygon tests on bounding-box hits
    def match_labels_to_rooms(
        self,
        labels: list[dict],
        room_contours: list[np.ndarray],
    ) -> dict[int, list[dict]]:
        """Match text labels to rooms by spatial containment.

        A label is matched to the first room contour whose polygon
        contains the label's centre point.

        TRAP (fixed 2026-10-06, Big O audit): this used to run
        ``pointPolygonTest`` for every label against every contour — O(T·R·v).
        Now an R-tree of contour bounding boxes narrows each label to the few
        rooms whose box holds its centre, and only those get the exact test,
        still in ascending index order so "first contour wins" is unchanged.

        Returns:
            Dict mapping room index (position in *room_contours*) to
            its list of matched label dicts.
        """
        matches: dict[int, list[dict]] = {}
        if not labels or not room_contours:
            return matches

        # O(V) time, O(R) space — V = total contour vertices; R = room contours
        # Rows of x, y, w, h.
        rects = np.array([cv2.boundingRect(cnt) for cnt in room_contours], dtype=float)
        # boundingRect's w/h count pixels inclusively, so the last pixel is x + w - 1.
        tree = STRtree(
            shapely.box(
                rects[:, 0],
                rects[:, 1],
                rects[:, 0] + rects[:, 2] - 1,
                rects[:, 1] + rects[:, 3] - 1,
            )
        )

        # O(T log R + K) time, O(1) space — T = labels; R = room contours; K = point-in-polygon work on bbox hits
        for label in labels:
            cx = label["x"] + label["width"] // 2
            cy = label["y"] + label["height"] // 2

            # O(k) time, O(k) space — k = point-in-polygon vertex work for this label's bbox hits (sums to K)
            # bigo-lint: disable=BIGO006 — amortised: per-label candidate work sums to K across the outer loop
            for idx in np.sort(tree.query(shapely.points(float(cx), float(cy)))):
                if cv2.pointPolygonTest(room_contours[idx], (float(cx), float(cy)), False) >= 0:
                    matches.setdefault(int(idx), []).append(label)
                    break

        return matches
