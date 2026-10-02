"""Upstream field names → our column names, shared by every city's importers.

PURPOSE
    Each city's open-data portal names the same thing differently (`taxpayer_1` vs
    `OWNER_NAME`), and portals rename or re-case fields without notice — the NHD service
    returns GNIS_NAME while the shared waterways importer read gnis_name, so every Detroit
    waterway would have imported with no name. A FieldMap keeps those names as data next to
    the city, so a renamed upstream column is a one-line fix and never a code change.

ARCHITECTURE
    FieldMap (frozen dataclass)  — one per upstream layer, lives in <city>/field_maps.py
    pick(props, field_map, col)  — the only lookup; first non-empty candidate wins
    Promoted here from detroit/field_maps.py (combined plan W1) so Dayton no longer imports
    from the Detroit package.

TO ADD A FIELD: add `"our_column": ("UPSTREAM_NAME", "fallback_name")` to the city's map,
    then read it with pick(). Set verified=True only after checking the live `?f=json`.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class FieldMap:
    """Our column name → upstream field name(s), first non-empty wins."""

    source: str
    fields: dict[str, tuple[str, ...]]
    verified: bool = False  # flip to True with a dated comment once checked live


def pick(props: dict, field_map: FieldMap, column: str) -> str | None:
    """O(k) time, O(1) space — k = candidate upstream names for the column (≤ 3).

    First non-empty upstream value for `column` as a stripped string, else None.
    Numbers are stringified (ArcGIS returns ints for codes like council district 3).
    An unknown column is a programming error, so it raises KeyError instead of
    silently returning None.
    """
    # O(k) time, O(1) space — k = candidate names
    for name in field_map.fields[column]:
        value = props.get(name)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None
