import React, { useCallback, useRef, useState } from 'react';
import { uploadFloorPlan } from '../api/floorPlans';
import type { FloorPlan } from '../api/floorPlans';

interface FloorPlanUploadProps {
  buildingId: string;
  onUploadComplete: (floorPlan: FloorPlan) => void;
  onClose: () => void;
}

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'application/pdf'];
const ACCEPTED_EXTENSIONS = '.png,.jpg,.jpeg,.svg,.pdf';

const FLOOR_LEVELS = [
  { value: -1, label: 'Basement' },
  { value: 0, label: 'Ground Floor' },
  { value: 1, label: '2nd Floor' },
  { value: 2, label: '3rd Floor' },
  { value: 3, label: '4th Floor' },
  { value: 4, label: '5th Floor' },
  { value: 5, label: '6th Floor' },
];

export const FloorPlanUpload: React.FC<FloorPlanUploadProps> = ({
  buildingId,
  onUploadComplete,
  onClose,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sourceType, setSourceType] = useState<string>('upload');
  const [level, setLevel] = useState<number>(0);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback((file: File): boolean => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Invalid file type. Please upload PNG, JPG, SVG, or PDF.');
      return false;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError('File too large. Maximum size is 50 MB.');
      return false;
    }
    setError(null);
    return true;
  }, []);

  const handleFileSelect = useCallback(
    (file: File) => {
      if (validateFile(file)) {
        setSelectedFile(file);
      }
    },
    [validateFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFileSelect(files[0]);
      }
    },
    [handleFileSelect],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFileSelect(files[0]);
      }
    },
    [handleFileSelect],
  );

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;

    setUploading(true);
    setProgress(0);
    setError(null);

    // Simulate progress since the API client doesn't support progress tracking
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + 10;
      });
    }, 200);

    try {
      const floorPlan = await uploadFloorPlan(buildingId, level, selectedFile);
      clearInterval(progressInterval);
      setProgress(100);
      onUploadComplete(floorPlan);
    } catch (err) {
      clearInterval(progressInterval);
      const message =
        err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setError(message);
      setProgress(0);
    } finally {
      setUploading(false);
    }
  }, [selectedFile, buildingId, level, onUploadComplete]);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>Upload Floor Plan</h3>
          <button
            style={styles.closeButton}
            onClick={onClose}
            aria-label="Close upload dialog"
          >
            &times;
          </button>
        </div>

        <div
          style={{
            ...styles.dropZone,
            ...(isDragging ? styles.dropZoneActive : {}),
            ...(selectedFile ? styles.dropZoneWithFile : {}),
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Drop zone for floor plan file upload"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            onChange={handleInputChange}
            style={styles.hiddenInput}
            aria-hidden="true"
          />
          {selectedFile ? (
            <div style={styles.fileInfo}>
              <span style={styles.fileIcon}>&#128196;</span>
              <span style={styles.fileName}>{selectedFile.name}</span>
              <span style={styles.fileSize}>
                {(selectedFile.size / 1024).toFixed(1)} KB
              </span>
            </div>
          ) : (
            <div style={styles.dropPrompt}>
              <span style={styles.uploadIcon}>&#8682;</span>
              <p style={styles.dropText}>
                Drag &amp; drop a floor plan file here
              </p>
              <p style={styles.dropSubtext}>
                or click to browse (PNG, JPG, SVG, PDF)
              </p>
            </div>
          )}
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.label} htmlFor="source-type-select">
            Source Type
          </label>
          <select
            id="source-type-select"
            style={styles.select}
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
            disabled={uploading}
          >
            <option value="upload">Upload</option>
            <option value="professional">Professional</option>
            <option value="sketch">Sketch</option>
            <option value="photo">Photo</option>
          </select>
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.label} htmlFor="floor-level-select">
            Floor Level
          </label>
          <select
            id="floor-level-select"
            style={styles.select}
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
            disabled={uploading}
          >
            {FLOOR_LEVELS.map((fl) => (
              <option key={fl.value} value={fl.value}>
                {fl.label}
              </option>
            ))}
          </select>
        </div>

        {uploading && (
          <div style={styles.progressContainer}>
            <div style={styles.progressTrack}>
              <div
                style={{ ...styles.progressBar, width: `${progress}%` }}
              />
            </div>
            <span style={styles.progressText}>{progress}%</span>
          </div>
        )}

        {error && <p style={styles.error}>{error}</p>}

        <div style={styles.actions}>
          <button
            style={styles.cancelButton}
            onClick={onClose}
            disabled={uploading}
          >
            Cancel
          </button>
          <button
            style={{
              ...styles.uploadButton,
              ...(!selectedFile || uploading ? styles.uploadButtonDisabled : {}),
            }}
            onClick={handleUpload}
            disabled={!selectedFile || uploading}
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: '#161b22',
    borderRadius: '8px',
    border: '1px solid #30363d',
    padding: '24px',
    width: '440px',
    maxWidth: '90vw',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  title: {
    margin: 0,
    color: '#c9d1d9',
    fontSize: '18px',
    fontWeight: 600,
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: '#8b949e',
    fontSize: '24px',
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
  },
  dropZone: {
    border: '2px dashed #30363d',
    borderRadius: '8px',
    padding: '32px 16px',
    textAlign: 'center' as const,
    cursor: 'pointer',
    transition: 'border-color 0.2s, background-color 0.2s',
    marginBottom: '16px',
    backgroundColor: '#0d1117',
  },
  dropZoneActive: {
    borderColor: '#58a6ff',
    backgroundColor: 'rgba(88, 166, 255, 0.08)',
  },
  dropZoneWithFile: {
    borderColor: '#3fb950',
    borderStyle: 'solid' as const,
  },
  hiddenInput: {
    display: 'none',
  },
  dropPrompt: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '8px',
  },
  uploadIcon: {
    fontSize: '32px',
    color: '#58a6ff',
  },
  dropText: {
    color: '#c9d1d9',
    fontSize: '14px',
    margin: 0,
  },
  dropSubtext: {
    color: '#8b949e',
    fontSize: '12px',
    margin: 0,
  },
  fileInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    justifyContent: 'center',
  },
  fileIcon: {
    fontSize: '20px',
  },
  fileName: {
    color: '#c9d1d9',
    fontSize: '14px',
    fontWeight: 500,
  },
  fileSize: {
    color: '#8b949e',
    fontSize: '12px',
  },
  fieldGroup: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    color: '#c9d1d9',
    fontSize: '13px',
    fontWeight: 500,
    marginBottom: '6px',
  },
  select: {
    width: '100%',
    padding: '8px 12px',
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: '6px',
    color: '#c9d1d9',
    fontSize: '14px',
    outline: 'none',
  },
  progressContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '16px',
  },
  progressTrack: {
    flex: 1,
    height: '6px',
    backgroundColor: '#21262d',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#58a6ff',
    borderRadius: '3px',
    transition: 'width 0.3s ease',
  },
  progressText: {
    color: '#8b949e',
    fontSize: '12px',
    minWidth: '36px',
    textAlign: 'right' as const,
  },
  error: {
    color: '#f85149',
    fontSize: '13px',
    marginBottom: '16px',
    margin: '0 0 16px 0',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
  },
  cancelButton: {
    padding: '8px 16px',
    backgroundColor: '#21262d',
    border: '1px solid #30363d',
    borderRadius: '6px',
    color: '#c9d1d9',
    fontSize: '14px',
    cursor: 'pointer',
  },
  uploadButton: {
    padding: '8px 16px',
    backgroundColor: '#238636',
    border: '1px solid #2ea043',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  uploadButtonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
};
