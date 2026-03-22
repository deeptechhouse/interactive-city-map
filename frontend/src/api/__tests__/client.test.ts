import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError, apiClient } from '../client';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ApiClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('GET requests', () => {
    it('calls fetch with correct URL and GET method', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: 'test' }),
      });

      const result = await apiClient.get('/api/v1/cities');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/v1/cities');
      expect(options.method).toBe('GET');
    });

    it('returns parsed JSON response', async () => {
      const expected = [{ slug: 'chicago', name: 'Chicago' }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => expected,
      });

      const result = await apiClient.get('/api/v1/cities');
      expect(result).toEqual(expected);
    });

    it('includes Content-Type header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await apiClient.get('/test');
      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Content-Type']).toBe('application/json');
    });
  });

  describe('POST requests', () => {
    it('calls fetch with POST method and JSON body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: '123' }),
      });

      const body = { name: 'Test POI', category: 'cafe' };
      await apiClient.post('/api/v1/pois', body);

      const [url, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.body).toBe(JSON.stringify(body));
    });
  });

  describe('PATCH requests', () => {
    it('calls fetch with PATCH method', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ is_hidden: true }),
      });

      await apiClient.patch('/api/v1/buildings/123', { is_hidden: true });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('PATCH');
    });
  });

  describe('PUT requests', () => {
    it('calls fetch with PUT method', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await apiClient.put('/api/v1/test', { key: 'value' });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('PUT');
    });
  });

  describe('DELETE requests', () => {
    it('calls fetch with DELETE method', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => undefined,
      });

      await apiClient.delete('/api/v1/test/123');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('DELETE');
    });
  });

  describe('error handling', () => {
    it('throws ApiError on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not found',
      });

      await expect(apiClient.get('/api/v1/missing')).rejects.toThrow(ApiError);
    });

    it('ApiError contains status code', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      try {
        await apiClient.get('/api/v1/broken');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(500);
      }
    });

    it('ApiError contains response body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => '{"detail":"Bad request"}',
      });

      try {
        await apiClient.post('/api/v1/pois', {});
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect((err as ApiError).body).toContain('Bad request');
      }
    });

    it('ApiError contains URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not found',
      });

      try {
        await apiClient.get('/api/v1/test');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect((err as ApiError).url).toContain('/api/v1/test');
      }
    });

    it('handles text() failure gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: async () => { throw new Error('cannot read body'); },
      });

      await expect(apiClient.get('/api/v1/broken')).rejects.toThrow(ApiError);
    });
  });

  describe('uploadFile', () => {
    it('sends FormData without Content-Type header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'fp-123' }),
      });

      const formData = new FormData();
      formData.append('file', new Blob(['test']), 'test.png');
      formData.append('level', '0');

      await apiClient.uploadFile('/api/v1/buildings/123/floor-plans', formData);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/floor-plans');
      expect(options.method).toBe('POST');
      expect(options.body).toBeInstanceOf(FormData);
      // Should NOT set Content-Type (browser sets multipart boundary automatically)
      expect(options.headers).toBeUndefined();
    });

    it('throws ApiError on upload failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 413,
        text: async () => 'Payload too large',
      });

      const formData = new FormData();
      await expect(
        apiClient.uploadFile('/api/v1/buildings/123/floor-plans', formData)
      ).rejects.toThrow(ApiError);
    });
  });
});

describe('ApiError', () => {
  it('extends Error', () => {
    const err = new ApiError(404, 'Not found', '/test');
    expect(err).toBeInstanceOf(Error);
  });

  it('has name property set to ApiError', () => {
    const err = new ApiError(500, 'Internal', '/test');
    expect(err.name).toBe('ApiError');
  });

  it('message includes status, url, and body', () => {
    const err = new ApiError(400, 'bad request', '/api/test');
    expect(err.message).toContain('400');
    expect(err.message).toContain('/api/test');
    expect(err.message).toContain('bad request');
  });
});
