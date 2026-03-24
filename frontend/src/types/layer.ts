export interface LayerConfig {
  id: string;
  name: string;
  group: LayerGroup;
  visible: boolean;
  opacity: number;
  sourceUrl: string;
}

export interface LayerState {
  id: string;
  name: string;
  group: LayerGroup;
  visible: boolean;
  opacity: number;
}

export type LayerGroup =
  | 'infrastructure'
  | 'zoning'
  | 'poi'
  | 'historical'
  | 'parks'
  | 'government'
  | 'safety';

export const LAYER_GROUP_LABELS: Record<LayerGroup, string> = {
  infrastructure: 'Infrastructure',
  zoning: 'Zoning & Ownership',
  poi: 'Points of Interest',
  historical: 'Historical',
  parks: 'Parks',
  government: 'Government',
  safety: 'Public Safety',
};
