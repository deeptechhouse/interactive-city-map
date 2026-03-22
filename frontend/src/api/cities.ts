import { apiClient } from './client';
import type { City } from '../types/city';

export async function getCities(): Promise<City[]> {
  return apiClient.get<City[]>('/api/cities');
}

export async function getCity(slug: string): Promise<City> {
  return apiClient.get<City>(`/api/cities/${slug}`);
}
