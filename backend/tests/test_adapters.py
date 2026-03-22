"""Tests for adapter interfaces and implementations.

External dependencies (boto3, httpx) are mocked — these are unit tests.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

import pytest

from app.adapters.storage import StorageAdapter, MinIOStorageAdapter, S3StorageAdapter, get_storage_adapter
from app.adapters.geocoder import (
    GeocoderAdapter,
    GeocodingError,
    PeliasGeocoderAdapter,
    CensusGeocoderAdapter,
    ChainedGeocoderAdapter,
)
from app.adapters.poi_fetcher import (
    POIFetcherAdapter,
    OverpassPOIFetcher,
    FoursquarePOIFetcher,
)


# ===========================================================================
# StorageAdapter interface
# ===========================================================================

class TestStorageAdapterInterface:
    """Verify the abstract interface declares all required methods."""

    def test_is_abstract(self):
        with pytest.raises(TypeError):
            StorageAdapter()

    def test_has_upload_file_method(self):
        assert hasattr(StorageAdapter, "upload_file")

    def test_has_get_file_url_method(self):
        assert hasattr(StorageAdapter, "get_file_url")

    def test_has_delete_file_method(self):
        assert hasattr(StorageAdapter, "delete_file")


# ===========================================================================
# MinIOStorageAdapter (mocked boto3)
# ===========================================================================

class TestMinIOStorageAdapter:
    """Tests for MinIOStorageAdapter with a mocked boto3 client."""

    @patch("app.adapters.storage.boto3")
    def test_upload_file_returns_url(self, mock_boto3):
        mock_client = MagicMock()
        mock_boto3.client.return_value = mock_client
        # head_bucket succeeds — bucket exists
        mock_client.head_bucket.return_value = {}

        adapter = MinIOStorageAdapter(
            endpoint_url="http://localhost:9000",
            access_key="test",
            secret_key="test",
            region="us-east-1",
        )
        url = adapter.upload_file(
            bucket="test-bucket",
            key="floor-plans/test.png",
            file_data=b"fake-png-data",
            content_type="image/png",
        )

        assert url == "http://localhost:9000/test-bucket/floor-plans/test.png"
        mock_client.put_object.assert_called_once()

    @patch("app.adapters.storage.boto3")
    def test_upload_file_creates_bucket_if_missing(self, mock_boto3):
        mock_client = MagicMock()
        mock_boto3.client.return_value = mock_client
        # head_bucket raises ClientError — bucket doesn't exist
        mock_client.exceptions.ClientError = type("ClientError", (Exception,), {})
        mock_client.head_bucket.side_effect = mock_client.exceptions.ClientError()

        adapter = MinIOStorageAdapter(
            endpoint_url="http://localhost:9000",
            access_key="test",
            secret_key="test",
            region="us-east-1",
        )
        adapter.upload_file(
            bucket="new-bucket",
            key="test.png",
            file_data=b"data",
            content_type="image/png",
        )

        mock_client.create_bucket.assert_called_once_with(Bucket="new-bucket")

    @patch("app.adapters.storage.boto3")
    def test_get_file_url(self, mock_boto3):
        mock_boto3.client.return_value = MagicMock()
        adapter = MinIOStorageAdapter(
            endpoint_url="http://localhost:9000",
            access_key="test",
            secret_key="test",
            region="us-east-1",
        )
        url = adapter.get_file_url("my-bucket", "path/to/file.png")
        assert url == "http://localhost:9000/my-bucket/path/to/file.png"

    @patch("app.adapters.storage.boto3")
    def test_delete_file(self, mock_boto3):
        mock_client = MagicMock()
        mock_boto3.client.return_value = mock_client
        adapter = MinIOStorageAdapter(
            endpoint_url="http://localhost:9000",
            access_key="test",
            secret_key="test",
            region="us-east-1",
        )
        adapter.delete_file("bucket", "key")
        mock_client.delete_object.assert_called_once_with(Bucket="bucket", Key="key")


# ===========================================================================
# S3StorageAdapter
# ===========================================================================

class TestS3StorageAdapter:
    """Tests for S3StorageAdapter URL generation."""

    @patch("app.adapters.storage.boto3")
    def test_get_file_url_format(self, mock_boto3):
        mock_boto3.client.return_value = MagicMock()
        adapter = S3StorageAdapter(
            access_key="test",
            secret_key="test",
            region="us-west-2",
        )
        url = adapter.get_file_url("my-bucket", "path/file.png")
        assert url == "https://my-bucket.s3.us-west-2.amazonaws.com/path/file.png"


# ===========================================================================
# get_storage_adapter factory
# ===========================================================================

class TestStorageAdapterFactory:
    """Tests for the factory function."""

    @patch("app.adapters.storage.settings")
    @patch("app.adapters.storage.boto3")
    def test_returns_minio_in_dev(self, mock_boto3, mock_settings):
        mock_boto3.client.return_value = MagicMock()
        mock_settings.app_env = "development"
        mock_settings.s3_endpoint_url = "http://localhost:9000"
        mock_settings.s3_access_key = "test"
        mock_settings.s3_secret_key = "test"
        mock_settings.s3_region = "us-east-1"
        adapter = get_storage_adapter()
        assert isinstance(adapter, MinIOStorageAdapter)

    @patch("app.adapters.storage.settings")
    @patch("app.adapters.storage.boto3")
    def test_returns_s3_in_production(self, mock_boto3, mock_settings):
        mock_boto3.client.return_value = MagicMock()
        mock_settings.app_env = "production"
        mock_settings.s3_access_key = "test"
        mock_settings.s3_secret_key = "test"
        mock_settings.s3_region = "us-east-1"
        adapter = get_storage_adapter()
        assert isinstance(adapter, S3StorageAdapter)


# ===========================================================================
# GeocoderAdapter interface
# ===========================================================================

class TestGeocoderAdapterInterface:
    """Verify the abstract interface."""

    def test_is_abstract(self):
        with pytest.raises(TypeError):
            GeocoderAdapter()

    def test_has_geocode_method(self):
        assert hasattr(GeocoderAdapter, "geocode")


# ===========================================================================
# PeliasGeocoderAdapter (mocked httpx)
# ===========================================================================

class TestPeliasGeocoderAdapter:
    """Tests for PeliasGeocoderAdapter with mocked HTTP."""

    @pytest.mark.asyncio
    async def test_geocode_success(self):
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "features": [
                {
                    "geometry": {
                        "coordinates": [-87.6354, 41.8789]
                    }
                }
            ]
        }

        with patch("app.adapters.geocoder.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client

            adapter = PeliasGeocoderAdapter(base_url="http://localhost:4000")
            lat, lon = await adapter.geocode("233 S Wacker Dr, Chicago")

        assert abs(lat - 41.8789) < 0.001
        assert abs(lon - (-87.6354)) < 0.001

    @pytest.mark.asyncio
    async def test_geocode_no_results_raises_error(self):
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"features": []}

        with patch("app.adapters.geocoder.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client

            adapter = PeliasGeocoderAdapter(base_url="http://localhost:4000")
            with pytest.raises(GeocodingError):
                await adapter.geocode("totally invalid address xyz")


# ===========================================================================
# ChainedGeocoderAdapter
# ===========================================================================

class TestChainedGeocoderAdapter:
    """Tests for the chained geocoder fallback logic."""

    @pytest.mark.asyncio
    async def test_uses_primary_when_successful(self):
        primary = AsyncMock()
        primary.geocode = AsyncMock(return_value=(41.88, -87.63))
        fallback = AsyncMock()
        fallback.geocode = AsyncMock(return_value=(0.0, 0.0))

        adapter = ChainedGeocoderAdapter(primary=primary, fallback=fallback)
        lat, lon = await adapter.geocode("test address")

        assert lat == 41.88
        assert lon == -87.63
        fallback.geocode.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_falls_back_on_primary_error(self):
        primary = AsyncMock()
        primary.geocode = AsyncMock(side_effect=GeocodingError("fail"))
        fallback = AsyncMock()
        fallback.geocode = AsyncMock(return_value=(41.88, -87.63))

        adapter = ChainedGeocoderAdapter(primary=primary, fallback=fallback)
        lat, lon = await adapter.geocode("test address")

        assert lat == 41.88
        fallback.geocode.assert_awaited_once()


# ===========================================================================
# OverpassPOIFetcher (mocked httpx)
# ===========================================================================

class TestOverpassPOIFetcher:
    """Tests for OverpassPOIFetcher with mocked HTTP responses."""

    @pytest.mark.asyncio
    async def test_fetch_pois_returns_results(self):
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "elements": [
                {
                    "id": 12345,
                    "lat": 41.88,
                    "lon": -87.63,
                    "tags": {
                        "name": "Lou Malnatis",
                        "amenity": "restaurant",
                        "addr:street": "439 N Wells St",
                    },
                },
                {
                    "id": 67890,
                    "lat": 41.89,
                    "lon": -87.64,
                    "tags": {
                        "name": "Intelligentsia",
                        "amenity": "cafe",
                    },
                },
            ]
        }

        with patch("app.adapters.poi_fetcher.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client

            fetcher = OverpassPOIFetcher()
            results = await fetcher.fetch_pois((-87.7, 41.8, -87.6, 41.9))

        assert len(results) == 2
        assert results[0]["name"] == "Lou Malnatis"
        assert results[0]["category"] == "restaurant"
        assert results[0]["source"] == "osm"
        assert results[1]["name"] == "Intelligentsia"

    @pytest.mark.asyncio
    async def test_fetch_pois_with_category_filter(self):
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"elements": []}

        with patch("app.adapters.poi_fetcher.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client

            fetcher = OverpassPOIFetcher()
            results = await fetcher.fetch_pois(
                (-87.7, 41.8, -87.6, 41.9), categories=["restaurant"]
            )

        assert results == []
        # Verify the API was actually called (category was mapped)
        mock_client.post.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_fetch_pois_unknown_category_returns_empty(self):
        fetcher = OverpassPOIFetcher()

        with patch("app.adapters.poi_fetcher.httpx.AsyncClient"):
            # Unknown category that's not in _CATEGORY_TAG_MAP
            results = await fetcher.fetch_pois(
                (-87.7, 41.8, -87.6, 41.9), categories=["nonexistent_category"]
            )

        assert results == []

    def test_derive_category_amenity(self):
        assert OverpassPOIFetcher._derive_category({"amenity": "restaurant"}) == "restaurant"

    def test_derive_category_shop(self):
        assert OverpassPOIFetcher._derive_category({"shop": "supermarket"}) == "shop"

    def test_derive_category_tourism(self):
        assert OverpassPOIFetcher._derive_category({"tourism": "museum"}) == "museum"

    def test_derive_category_other(self):
        assert OverpassPOIFetcher._derive_category({}) == "other"

    @pytest.mark.asyncio
    async def test_skips_elements_without_coordinates(self):
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "elements": [
                {"id": 1, "tags": {"name": "No coords"}},
            ]
        }

        with patch("app.adapters.poi_fetcher.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client

            fetcher = OverpassPOIFetcher()
            results = await fetcher.fetch_pois((-87.7, 41.8, -87.6, 41.9))

        assert len(results) == 0


# ===========================================================================
# POIFetcherAdapter interface
# ===========================================================================

class TestPOIFetcherAdapterInterface:
    """Verify the abstract interface."""

    def test_is_abstract(self):
        with pytest.raises(TypeError):
            POIFetcherAdapter()

    def test_has_fetch_pois_method(self):
        assert hasattr(POIFetcherAdapter, "fetch_pois")
