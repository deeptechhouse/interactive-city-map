import { apiBaseUrl } from '../utils/geoUtils';
import { IS_STATIC } from '../utils/staticMode';

class ApiClient {
  private baseUrl: string;

  // O(1) time, O(1) space
  constructor() {
    this.baseUrl = apiBaseUrl();
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    if (IS_STATIC) {
      // In static mode, backend API is unavailable — return empty defaults
      // so the UI degrades gracefully instead of throwing network errors.
      throw new ApiError(0, 'API unavailable in static mode', path);
    }

    const url = `${this.baseUrl}${path}`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new ApiError(response.status, errorBody, url);
    }

    return response.json() as Promise<T>;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  async delete(path: string): Promise<void> {
    await this.request<void>(path, { method: 'DELETE' });
  }

  async uploadFile<T>(path: string, formData: FormData): Promise<T> {
    if (IS_STATIC) {
      throw new ApiError(0, 'File upload unavailable in static mode', path);
    }

    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new ApiError(response.status, errorBody, url);
    }

    return response.json() as Promise<T>;
  }
}

export class ApiError extends Error {
  // O(m) time, O(m) space — m = length of the response body text (copied into the message)
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly url: string,
  ) {
    super(`API Error ${status} at ${url}: ${body}`);
    this.name = 'ApiError';
  }
}

export const apiClient = new ApiClient();
