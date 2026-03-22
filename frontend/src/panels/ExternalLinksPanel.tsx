import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';

interface ExternalLinks {
  loopnet_url?: string;
  insurance_map_volume?: string;
  insurance_map_sheet?: string;
  insurance_map_year?: string;
  county_assessor_url?: string;
}

interface ExternalLinksPanelProps {
  buildingId: string;
  parcelPin?: string | null;
  /** Existing external_links data from the building record */
  initialLinks?: ExternalLinks;
}

const COOK_COUNTY_ASSESSOR_BASE =
  'https://www.cookcountyassessor.com/pin/';

function generateAssessorUrl(parcelPin: string | null | undefined): string | null {
  if (!parcelPin) return null;
  const cleaned = parcelPin.replace(/[^0-9]/g, '');
  if (cleaned.length === 0) return null;
  return `${COOK_COUNTY_ASSESSOR_BASE}${cleaned}`;
}

export const ExternalLinksPanel: React.FC<ExternalLinksPanelProps> = ({
  buildingId,
  parcelPin,
  initialLinks,
}) => {
  const [loopnetUrl, setLoopnetUrl] = useState(initialLinks?.loopnet_url ?? '');
  const [insuranceVolume, setInsuranceVolume] = useState(
    initialLinks?.insurance_map_volume ?? '',
  );
  const [insuranceSheet, setInsuranceSheet] = useState(
    initialLinks?.insurance_map_sheet ?? '',
  );
  const [insuranceYear, setInsuranceYear] = useState(
    initialLinks?.insurance_map_year ?? '',
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assessorUrl = generateAssessorUrl(parcelPin);

  // Reset saved indicator after a delay
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [saved]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSaved(false);

    const externalLinks: ExternalLinks = {
      loopnet_url: loopnetUrl || undefined,
      insurance_map_volume: insuranceVolume || undefined,
      insurance_map_sheet: insuranceSheet || undefined,
      insurance_map_year: insuranceYear || undefined,
      county_assessor_url: assessorUrl ?? undefined,
    };

    try {
      await apiClient.patch(`/api/v1/buildings/${buildingId}`, {
        external_links: externalLinks,
      });
      setSaved(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to save links.';
      setError(message);
    } finally {
      setSaving(false);
    }
  }, [buildingId, loopnetUrl, insuranceVolume, insuranceSheet, insuranceYear, assessorUrl]);

  return (
    <div style={styles.container}>
      <h4 style={styles.sectionTitle}>External Links</h4>

      {/* LoopNet URL */}
      <div style={styles.fieldGroup}>
        <label style={styles.label} htmlFor="ext-loopnet-url">
          LoopNet URL
        </label>
        <input
          id="ext-loopnet-url"
          type="url"
          style={styles.input}
          value={loopnetUrl}
          onChange={(e) => setLoopnetUrl(e.target.value)}
          placeholder="https://www.loopnet.com/listing/..."
          disabled={saving}
        />
      </div>

      {/* Insurance Map Reference */}
      <fieldset style={styles.fieldset}>
        <legend style={styles.legend}>Insurance Map Reference</legend>
        <div style={styles.inlineFields}>
          <div style={styles.inlineField}>
            <label style={styles.smallLabel} htmlFor="ext-ins-volume">
              Volume
            </label>
            <input
              id="ext-ins-volume"
              type="text"
              style={styles.smallInput}
              value={insuranceVolume}
              onChange={(e) => setInsuranceVolume(e.target.value)}
              placeholder="Vol."
              disabled={saving}
            />
          </div>
          <div style={styles.inlineField}>
            <label style={styles.smallLabel} htmlFor="ext-ins-sheet">
              Sheet
            </label>
            <input
              id="ext-ins-sheet"
              type="text"
              style={styles.smallInput}
              value={insuranceSheet}
              onChange={(e) => setInsuranceSheet(e.target.value)}
              placeholder="Sheet"
              disabled={saving}
            />
          </div>
          <div style={styles.inlineField}>
            <label style={styles.smallLabel} htmlFor="ext-ins-year">
              Year
            </label>
            <input
              id="ext-ins-year"
              type="text"
              style={styles.smallInput}
              value={insuranceYear}
              onChange={(e) => setInsuranceYear(e.target.value)}
              placeholder="Year"
              disabled={saving}
            />
          </div>
        </div>
      </fieldset>

      {/* County Assessor (auto-generated) */}
      <div style={styles.fieldGroup}>
        <label style={styles.label}>County Assessor</label>
        {assessorUrl ? (
          <a
            href={assessorUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={styles.link}
          >
            {assessorUrl}
          </a>
        ) : (
          <span style={styles.noData}>
            No parcel PIN available
          </span>
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}

      <div style={styles.actions}>
        {saved && <span style={styles.savedIndicator}>Saved</span>}
        <button
          style={{
            ...styles.saveButton,
            ...(saving ? styles.saveButtonDisabled : {}),
          }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Links'}
        </button>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    backgroundColor: '#161b22',
    borderRadius: '8px',
    border: '1px solid #30363d',
    padding: '14px',
  },
  sectionTitle: {
    margin: '0 0 12px 0',
    color: '#c9d1d9',
    fontSize: '14px',
    fontWeight: 600,
  },
  fieldGroup: {
    marginBottom: '12px',
  },
  label: {
    display: 'block',
    color: '#8b949e',
    fontSize: '12px',
    fontWeight: 500,
    marginBottom: '4px',
  },
  input: {
    width: '100%',
    padding: '6px 10px',
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: '6px',
    color: '#c9d1d9',
    fontSize: '13px',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  fieldset: {
    border: '1px solid #21262d',
    borderRadius: '6px',
    padding: '10px',
    marginBottom: '12px',
    margin: '0 0 12px 0',
  },
  legend: {
    color: '#8b949e',
    fontSize: '12px',
    fontWeight: 500,
    padding: '0 4px',
  },
  inlineFields: {
    display: 'flex',
    gap: '8px',
  },
  inlineField: {
    flex: 1,
  },
  smallLabel: {
    display: 'block',
    color: '#8b949e',
    fontSize: '11px',
    marginBottom: '3px',
  },
  smallInput: {
    width: '100%',
    padding: '5px 8px',
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: '4px',
    color: '#c9d1d9',
    fontSize: '12px',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  link: {
    color: '#58a6ff',
    fontSize: '12px',
    wordBreak: 'break-all' as const,
    textDecoration: 'none',
  },
  noData: {
    color: '#484f58',
    fontSize: '12px',
    fontStyle: 'italic' as const,
  },
  error: {
    color: '#f85149',
    fontSize: '12px',
    margin: '0 0 8px 0',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: '10px',
    marginTop: '4px',
  },
  savedIndicator: {
    color: '#3fb950',
    fontSize: '12px',
    fontWeight: 500,
  },
  saveButton: {
    padding: '6px 14px',
    backgroundColor: '#238636',
    border: '1px solid #2ea043',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  saveButtonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
};
