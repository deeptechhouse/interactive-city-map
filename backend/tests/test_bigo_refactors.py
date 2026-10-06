"""Equivalence tests for the 2026-10-06 Big O refactors.

Each fast implementation is checked against a brute-force reference that
spells out the intended behaviour, on seeded random input. If one of these
fails after an edit, the fast path no longer matches its definition.
"""

from __future__ import annotations

import random
from types import SimpleNamespace
from unittest.mock import MagicMock

import cv2
import numpy as np
import pytest

from app.services.extractors.line_detector import LineDetector
from app.services.extractors.room_segmenter import RoomSegmenter
from app.services.extractors.sanborn_parser import SanbornParser
from app.services.extractors.text_extractor import TextExtractor

# ---------------------------------------------------------------------------
# Brute-force references
# ---------------------------------------------------------------------------


def _merge_reference(lines, angle_thresh=5.0, dist_thresh=10.0):
    """The O(L²) greedy merge, with the 2026-10-06 (len_i + len_j)/2 threshold."""
    merged, used = [], set()
    for i, (x1, y1, x2, y2) in enumerate(lines):
        if i in used:
            continue
        a_i = np.degrees(np.arctan2(y2 - y1, x2 - x1)) % 180
        group = [(x1, y1, x2, y2)]
        used.add(i)
        for j, (x3, y3, x4, y4) in enumerate(lines):
            if j in used:
                continue
            a_j = np.degrees(np.arctan2(y4 - y3, x4 - x3)) % 180
            d = abs(a_i - a_j)
            if d > angle_thresh and abs(d - 180) > angle_thresh:
                continue
            dist = np.hypot((x1 + x2) / 2 - (x3 + x4) / 2, (y1 + y2) / 2 - (y3 + y4) / 2)
            half = (np.hypot(x2 - x1, y2 - y1) + np.hypot(x4 - x3, y4 - y3)) / 2
            if dist < dist_thresh + half:
                group.append((x3, y3, x4, y4))
                used.add(j)
        merged.append(LineDetector._collapse(group, a_i))
    return merged


def _match_reference(labels, contours):
    matches = {}
    for label in labels:
        cx = label["x"] + label["width"] // 2
        cy = label["y"] + label["height"] // 2
        for idx, cnt in enumerate(contours):
            if cv2.pointPolygonTest(cnt, (float(cx), float(cy)), False) >= 0:
                matches.setdefault(idx, []).append(label)
                break
    return matches


def _random_wall_segments(rng: random.Random, n: int) -> list[tuple[int, int, int, int]]:
    """Mostly axis-aligned walls with gaps and jitter — what Hough gives on a floor plan."""
    out = []
    for _ in range(n):
        x, y, length = rng.randint(0, 400), rng.randint(0, 400), rng.randint(5, 120)
        jitter = rng.randint(-2, 2)
        if rng.random() < 0.45:
            out.append((x, y, x + length, y + jitter))
        elif rng.random() < 0.9:
            out.append((x, y, x + jitter, y + length))
        else:
            out.append((x, y, x + rng.randint(-60, 60), y + rng.randint(-60, 60)))
    return out


# ---------------------------------------------------------------------------
# LineDetector._merge_collinear
# ---------------------------------------------------------------------------


class TestMergeCollinearEquivalence:
    @pytest.mark.parametrize("seed", range(12))
    def test_matches_bruteforce(self, seed):
        rng = random.Random(seed)
        lines = _random_wall_segments(rng, rng.randint(1, 250))
        assert LineDetector()._merge_collinear(lines) == _merge_reference(lines)

    def test_matches_bruteforce_custom_thresholds(self):
        lines = _random_wall_segments(random.Random(99), 200)
        got = LineDetector()._merge_collinear(lines, angle_thresh=12.0, dist_thresh=25.0)
        assert got == _merge_reference(lines, angle_thresh=12.0, dist_thresh=25.0)

    def test_duplicate_and_zero_length_segments(self):
        lines = [(10, 10, 10, 10), (10, 10, 10, 10), (0, 0, 30, 0), (0, 0, 30, 0)]
        assert LineDetector()._merge_collinear(lines) == _merge_reference(lines)


# ---------------------------------------------------------------------------
# TextExtractor.match_labels_to_rooms
# ---------------------------------------------------------------------------


def _square(x, y, s):
    return np.array([[[x, y]], [[x + s, y]], [[x + s, y + s]], [[x, y + s]]], dtype=np.int32)


class TestMatchLabelsEquivalence:
    @pytest.mark.parametrize("seed", range(8))
    def test_matches_bruteforce_with_overlaps(self, seed):
        rng = random.Random(seed)
        # Overlapping rooms make "first contour wins" observable.
        contours = [
            _square(rng.randint(0, 300), rng.randint(0, 300), rng.randint(10, 120))
            for _ in range(40)
        ]
        labels = [
            {
                "x": rng.randint(0, 420),
                "y": rng.randint(0, 420),
                "width": rng.randint(1, 20),
                "height": rng.randint(1, 10),
                "text": f"L{k}",
            }
            for k in range(150)
        ]
        assert TextExtractor().match_labels_to_rooms(labels, contours) == _match_reference(
            labels, contours
        )

    def test_label_on_boundary_counts_as_inside(self):
        cnt = _square(0, 0, 10)
        label = {
            "x": 10,
            "y": 4,
            "width": 0,
            "height": 2,
            "text": "edge",
        }  # centre (10, 5) on the right edge
        assert TextExtractor().match_labels_to_rooms([label], [cnt]) == {0: [label]}

    def test_empty_inputs(self):
        assert TextExtractor().match_labels_to_rooms([], [_square(0, 0, 5)]) == {}
        assert (
            TextExtractor().match_labels_to_rooms([{"x": 0, "y": 0, "width": 1, "height": 1}], [])
            == {}
        )


# ---------------------------------------------------------------------------
# RoomSegmenter.indexed_polygons — contour/polygon alignment bug
# ---------------------------------------------------------------------------


class TestIndexedPolygons:
    def test_keeps_contour_index_after_a_dropped_contour(self):
        bowtie = np.array(
            [[[0, 0]], [[10, 10]], [[10, 0]], [[0, 10]]], dtype=np.int32
        )  # self-intersecting
        good = _square(50, 50, 20)
        pairs = RoomSegmenter().indexed_polygons([bowtie, good])
        assert [idx for idx, _ in pairs] == [1]
        assert RoomSegmenter().contours_to_polygons([bowtie, good])[0].equals(pairs[0][1])

    def test_generic_extraction_labels_follow_their_room(self):
        """A dropped contour must not shift labels onto the next room."""
        from app.services.floor_plan_extractor import FloorPlanExtractor

        bowtie = np.array([[[0, 0]], [[10, 10]], [[10, 0]], [[0, 10]]], dtype=np.int32)
        kitchen, office = _square(100, 100, 40), _square(200, 100, 40)
        ext = FloorPlanExtractor()
        ext._line_detector = MagicMock(detect=MagicMock(return_value=[]))
        ext._room_segmenter.segment = MagicMock(return_value=[bowtie, kitchen, office])
        ext._text_extractor.extract_text_regions = MagicMock(
            return_value=[
                {"x": 215, "y": 115, "width": 10, "height": 10, "text": "Office"},
                {"x": 115, "y": 115, "width": 10, "height": 10, "text": "Kitchen"},
            ]
        )
        rooms, _, _ = ext._extract_generic(np.zeros((300, 300, 3), dtype=np.uint8))
        assert [r["name"] for r in rooms] == ["Kitchen", "Office"]


# ---------------------------------------------------------------------------
# SanbornParser — per-room crop gives the same material as a full-image mask
# ---------------------------------------------------------------------------


class TestSanbornCrop:
    def test_crop_matches_full_image_mask(self):
        img = np.full((200, 300, 3), 255, dtype=np.uint8)
        img[20:80, 20:120] = (60, 60, 200)  # brick-ish red (BGR)
        img[100:180, 150:280] = (40, 200, 230)  # frame-ish yellow
        parser = SanbornParser()
        for cnt in (_square(20, 20, 60), _square(150, 100, 79)):
            full = np.zeros(img.shape[:2], dtype=np.uint8)
            cv2.drawContours(full, [cnt], 0, 255, -1)
            x, y, w, h = cv2.boundingRect(cnt)
            crop = np.zeros((h, w), dtype=np.uint8)
            cv2.drawContours(crop, [cnt], 0, 255, -1, offset=(-x, -y))
            assert np.count_nonzero(crop) == np.count_nonzero(full)
            assert parser.detect_material(
                img[y : y + h, x : x + w], crop
            ) == parser.detect_material(img, full)


# ---------------------------------------------------------------------------
# PermitImporter — single city-scoped index instead of a query per permit
# ---------------------------------------------------------------------------


class TestPermitImporter:
    def _importer(self, buildings):
        from app.data_import.interior.permit_importer import PermitImporter

        session = MagicMock()
        session.execute.return_value.scalars.return_value = iter(buildings)
        return PermitImporter(session), session

    def test_one_query_for_many_permits_and_first_match_wins(self):
        a = SimpleNamespace(address="100 West Main Street", metadata_=None)
        b = SimpleNamespace(address="100 W MAIN ST", metadata_={"x": 1})  # same normalised address
        importer, session = self._importer([a, b])
        permits = [
            {
                "street_number": "100",
                "street_direction": "W",
                "street_name": "MAIN ST",
                "permit_": str(k),
            }
            for k in range(5)
        ]
        stats = importer.link_permits_to_buildings(permits)
        assert session.execute.call_count == 1
        assert stats == {"permits_processed": 5, "buildings_matched": 5}
        assert [p["permit_number"] for p in a.metadata_["permits"]] == ["0", "1", "2", "3", "4"]
        assert b.metadata_ == {"x": 1}

    def test_query_is_scoped_to_chicago(self):
        importer, session = self._importer([])
        importer.link_permits_to_buildings([])
        sql = str(session.execute.call_args[0][0].compile(compile_kwargs={"literal_binds": True}))
        assert "cities.slug = 'chicago'" in sql

    def test_metadata_is_reassigned_not_mutated(self):
        original = {"permits": [{"permit_number": "old"}]}
        bldg = SimpleNamespace(address="1 N STATE ST", metadata_=original)
        importer, _ = self._importer([bldg])
        importer.link_permits_to_buildings(
            [{"street_number": "1", "street_direction": "N", "street_name": "STATE ST"}]
        )
        assert bldg.metadata_ is not original and len(bldg.metadata_["permits"]) == 2
        assert len(original["permits"]) == 1


# ---------------------------------------------------------------------------
# VenueScraperRunner — building row fetched once per target, not per image
# ---------------------------------------------------------------------------


class TestVenueRunnerHoist:
    def test_one_building_query_for_many_floor_plans(self, monkeypatch):
        import uuid

        from app.data_import.interior import venue_scraper_runner as mod

        monkeypatch.setattr(
            mod,
            "get_storage_adapter",
            lambda: MagicMock(upload_file=MagicMock(return_value="s3://x")),
        )
        monkeypatch.setattr(mod.FloorPlanClassifier, "load_model", lambda self: False)
        session = MagicMock()
        city_id = uuid.uuid4()
        session.execute.return_value.one_or_none.return_value = (
            city_id,
            None,
        )  # no geom → georef skipped
        runner = mod.VenueScraperRunner(session)
        runner._scraper = MagicMock(
            crawl=MagicMock(
                return_value=[{"url": f"https://v.example/plan{k}.png"} for k in range(4)]
            ),
            download_image=MagicMock(return_value=(b"img", "image/png")),
        )
        runner._classifier = MagicMock(predict=MagicMock(return_value=(True, 0.9)))
        target = SimpleNamespace(
            url="https://v.example", building_id=uuid.uuid4(), floor_plan_urls=None
        )
        stats = {"plans_found": 0, "plans_stored": 0}

        runner._process_target(target, stats)

        assert stats == {"plans_found": 4, "plans_stored": 4}
        assert session.execute.call_count == 1
        sources = [c.args[0] for c in session.add.call_args_list]
        assert {s.city_id for s in sources} == {city_id}

    def test_no_query_when_nothing_found(self, monkeypatch):
        from app.data_import.interior import venue_scraper_runner as mod

        monkeypatch.setattr(mod, "get_storage_adapter", lambda: MagicMock())
        monkeypatch.setattr(mod.FloorPlanClassifier, "load_model", lambda self: False)
        session = MagicMock()
        runner = mod.VenueScraperRunner(session)
        runner._scraper = MagicMock(
            crawl=MagicMock(return_value=[{"url": "u"}]),
            download_image=MagicMock(return_value=(None, "")),
        )
        runner._process_target(
            SimpleNamespace(url="x", building_id=None, floor_plan_urls=None),
            {"plans_found": 0, "plans_stored": 0},
        )
        session.execute.assert_not_called()


# ---------------------------------------------------------------------------
# VenueScraperService.crawl — deque keeps the old list-queue visit order
# ---------------------------------------------------------------------------


class TestCrawlOrder:
    SITE = {
        "https://v.example/": [
            '<a href="/about">About</a>',
            '<a href="/floor-plans">Floor plans</a>',
            '<a href="/contact">x</a>',
        ],
        "https://v.example/floor-plans": [
            '<a href="/gallery">Gallery</a>',
            '<a href="/about">About</a>',
            '<img src="/img/floor-plan.png" alt="floor plan">',
        ],
        "https://v.example/gallery": [
            '<a href="/">Home</a>',
            '<a href="https://other.example/x">ext</a>',
        ],
        "https://v.example/about": ['<a href="/contact">Contact</a>'],
        "https://v.example/contact": [],
    }

    def _fake_client(self, visited):
        site = self.SITE

        class _Resp:
            def __init__(self, url):
                self.status_code = 200 if url in site else 404
                self.headers = {"content-type": "text/html"}
                self.text = "<html>" + "".join(site.get(url, [])) + "</html>"

        class _Client:
            def __init__(self, *a, **k):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def get(self, url):
                visited.append(url)
                return _Resp(url)

        return _Client

    def test_visit_order_priority_links_first(self, monkeypatch):
        from app.services import venue_scraper_service as mod

        visited: list[str] = []
        monkeypatch.setattr(mod.httpx, "Client", self._fake_client(visited))
        svc = mod.VenueScraperService()
        monkeypatch.setattr(svc, "_check_robots", lambda url: True)
        monkeypatch.setattr(svc, "_rate_limit", lambda domain: None)

        candidates = svc.crawl("https://v.example/", max_pages=10)

        # Same order the old list-based queue produced: priority links jump the queue (LIFO).
        assert visited == [
            "https://v.example/",
            "https://v.example/floor-plans",
            "https://v.example/gallery",
            "https://v.example/about",
            "https://v.example/contact",
        ]
        assert candidates[0]["url"] == "https://v.example/img/floor-plan.png"


# ---------------------------------------------------------------------------
# detroit.common.split_arcgis_rings — R-tree hole → shell lookup
# ---------------------------------------------------------------------------


def _ring(x, y, s, ccw):
    pts = [(x, y), (x + s, y), (x + s, y + s), (x, y + s), (x, y)]  # counter-clockwise
    return pts if ccw else pts[::-1]


class TestSplitArcgisRings:
    def test_many_parts_each_hole_joins_its_own_shell(self):
        from app.data_import.detroit.common import split_arcgis_rings

        rings = []
        for k in range(30):  # 30 two-unit parts in a row, each with one courtyard hole
            rings.append(_ring(k * 20, 0, 10, ccw=False))  # clockwise outer
            rings.append(_ring(k * 20 + 3, 3, 2, ccw=True))  # counter-clockwise hole
        polys = split_arcgis_rings({"type": "Polygon", "coordinates": rings})
        assert len(polys) == 30
        assert all(len(p.interiors) == 1 for p in polys)
        assert all(
            p.contains(p.interiors[0].centroid) is False for p in polys
        )  # it really is a hole

    def test_first_containing_shell_wins_on_overlap(self):
        from app.data_import.detroit.common import split_arcgis_rings

        big, small = _ring(0, 0, 100, ccw=False), _ring(10, 10, 30, ccw=False)
        hole = _ring(15, 15, 5, ccw=True)
        polys = split_arcgis_rings({"type": "Polygon", "coordinates": [big, small, hole]})
        assert [len(p.interiors) for p in polys] == [1, 0]


# ---------------------------------------------------------------------------
# Moderation queue — LIMIT pushed into SQL
# ---------------------------------------------------------------------------

class TestModerationLimit:
    @pytest.mark.asyncio
    async def test_limit_is_in_the_sql(self):
        from app.services.interior_source_service import InteriorSourceService

        session = MagicMock()

        async def _exec(stmt):
            session.stmt = stmt
            return MagicMock(scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[]))))

        session.execute = _exec
        await InteriorSourceService.get_sources_by_status("reported", session, limit=50)
        assert session.stmt._limit_clause is not None
        await InteriorSourceService.get_sources_by_status("reported", session)
        assert session.stmt._limit_clause is None  # default unchanged: no limit


# ---------------------------------------------------------------------------
# PhoneLookupService — chain cache bounded by configured cities
# ---------------------------------------------------------------------------

class TestPhoneChainCache:
    def test_unknown_cities_share_the_default_chain(self):
        from app.services.phone_lookup_service import PhoneLookupService, SlidingWindowRateLimiter

        built: list[list[str]] = []

        def factory(names):
            built.append(list(names))
            return SimpleNamespace(provider_names=tuple(names))

        svc = PhoneLookupService(["google"], {"detroit": ["foursquare", "google"]},
                                 SlidingWindowRateLimiter(10), chain_factory=factory)
        for k in range(500):
            assert svc.providers_for(f"made-up-{k}") == ("google",)
        assert svc.providers_for("Detroit") == ("foursquare", "google")
        assert svc.providers_for("chicago") == ("google",)
        assert built == [["google"], ["foursquare", "google"]]  # 2 chains, not 502
