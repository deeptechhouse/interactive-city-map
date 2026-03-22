"""Storage adapters for file upload/retrieval (MinIO, S3)."""

from abc import ABC, abstractmethod
from typing import Union

import boto3
from botocore.config import Config as BotoConfig

from app.config import settings


class StorageAdapter(ABC):
    """Abstract interface for object-storage operations."""

    @abstractmethod
    def upload_file(
        self, bucket: str, key: str, file_data: Union[bytes, object], content_type: str
    ) -> str:
        """Upload a file and return its public URL."""

    @abstractmethod
    def get_file_url(self, bucket: str, key: str) -> str:
        """Return a pre-signed or public URL for the given object."""

    @abstractmethod
    def delete_file(self, bucket: str, key: str) -> None:
        """Delete an object from storage."""


class MinIOStorageAdapter(StorageAdapter):
    """MinIO-backed storage adapter using the S3-compatible API."""

    def __init__(
        self,
        endpoint_url: str = settings.s3_endpoint_url,
        access_key: str = settings.s3_access_key,
        secret_key: str = settings.s3_secret_key,
        region: str = settings.s3_region,
    ):
        self._endpoint_url = endpoint_url
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
            config=BotoConfig(signature_version="s3v4"),
        )

    def _ensure_bucket(self, bucket: str) -> None:
        try:
            self._client.head_bucket(Bucket=bucket)
        except self._client.exceptions.ClientError:
            self._client.create_bucket(Bucket=bucket)

    def upload_file(
        self, bucket: str, key: str, file_data: Union[bytes, object], content_type: str
    ) -> str:
        self._ensure_bucket(bucket)
        self._client.put_object(
            Bucket=bucket,
            Key=key,
            Body=file_data,
            ContentType=content_type,
        )
        return self.get_file_url(bucket, key)

    def get_file_url(self, bucket: str, key: str) -> str:
        return f"{self._endpoint_url}/{bucket}/{key}"

    def delete_file(self, bucket: str, key: str) -> None:
        self._client.delete_object(Bucket=bucket, Key=key)


class S3StorageAdapter(StorageAdapter):
    """AWS S3-backed storage adapter. Same logic as MinIO but uses standard S3 endpoint."""

    def __init__(
        self,
        access_key: str = settings.s3_access_key,
        secret_key: str = settings.s3_secret_key,
        region: str = settings.s3_region,
    ):
        self._region = region
        self._client = boto3.client(
            "s3",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
        )

    def upload_file(
        self, bucket: str, key: str, file_data: Union[bytes, object], content_type: str
    ) -> str:
        self._client.put_object(
            Bucket=bucket,
            Key=key,
            Body=file_data,
            ContentType=content_type,
        )
        return self.get_file_url(bucket, key)

    def get_file_url(self, bucket: str, key: str) -> str:
        return f"https://{bucket}.s3.{self._region}.amazonaws.com/{key}"

    def delete_file(self, bucket: str, key: str) -> None:
        self._client.delete_object(Bucket=bucket, Key=key)


def get_storage_adapter() -> StorageAdapter:
    """Factory: return the appropriate storage adapter based on environment."""
    if settings.app_env == "production":
        return S3StorageAdapter()
    return MinIOStorageAdapter()
