import { useState, useCallback, useMemo } from 'react';

export type EditorTool = 'select' | 'draw-wall' | 'draw-room' | 'draw-feature' | 'measure' | null;
export type FeaturePlacementType = 'door' | 'stair' | 'elevator' | 'restroom' | 'exit' | 'utility';

export interface EditorAction {
  type: 'create-room' | 'create-wall' | 'create-feature' | 'delete-room' | 'delete-wall' | 'delete-feature';
  data: unknown;
  undoData?: unknown;
}

export interface UseInteriorEditorResult {
  activeTool: EditorTool;
  setActiveTool: (tool: EditorTool) => void;
  featurePlacementType: FeaturePlacementType;
  setFeaturePlacementType: (type: FeaturePlacementType) => void;
  undoStack: EditorAction[];
  redoStack: EditorAction[];
  pushAction: (action: EditorAction) => void;
  undo: () => EditorAction | null;
  redo: () => EditorAction | null;
  canUndo: boolean;
  canRedo: boolean;
  selectedFeatureId: string | null;
  setSelectedFeatureId: (id: string | null) => void;
  isEditing: boolean;
}

export function useInteriorEditor(): UseInteriorEditorResult {
  const [activeTool, setActiveTool] = useState<EditorTool>(null);
  const [featurePlacementType, setFeaturePlacementType] = useState<FeaturePlacementType>('door');
  const [undoStack, setUndoStack] = useState<EditorAction[]>([]);
  const [redoStack, setRedoStack] = useState<EditorAction[]>([]);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);

  const pushAction = useCallback((action: EditorAction) => {
    setUndoStack((prev) => [...prev, action]);
    setRedoStack([]);
  }, []);

  const undo = useCallback((): EditorAction | null => {
    let popped: EditorAction | null = null;
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      popped = next.pop()!;
      return next;
    });
    if (popped) {
      setRedoStack((prev) => [...prev, popped!]);
    }
    return popped;
  }, []);

  const redo = useCallback((): EditorAction | null => {
    let popped: EditorAction | null = null;
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      popped = next.pop()!;
      return next;
    });
    if (popped) {
      setUndoStack((prev) => [...prev, popped!]);
    }
    return popped;
  }, []);

  const canUndo = useMemo(() => undoStack.length > 0, [undoStack]);
  const canRedo = useMemo(() => redoStack.length > 0, [redoStack]);
  const isEditing = activeTool !== null;

  return {
    activeTool,
    setActiveTool,
    featurePlacementType,
    setFeaturePlacementType,
    undoStack,
    redoStack,
    pushAction,
    undo,
    redo,
    canUndo,
    canRedo,
    selectedFeatureId,
    setSelectedFeatureId,
    isEditing,
  };
}
