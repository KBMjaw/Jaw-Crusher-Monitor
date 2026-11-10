"""
tests/test_reports.py
Unit tests for PDF and CSV report generation.
No hardware required — tests pure Python output.
"""

import csv
import io
import pytest
from reports import build_shift_pdf, build_shift_csv


# ── Fixtures ─────────────────────────────────────────────────────────────

@pytest.fixture
def sample_live_state():
    return {
        "timer_run"       : "06:30:00",
        "timer_stuck"     : "00:15:00",
        "timer_no_feed"   : "00:45:00",
        "availability_pct": 81.5,
        "session_start"   : "2026-05-13 06:00:00",
        "last_active"     : "2026-05-13 12:30:00",
        "tonnage_actual"  : 142.5,
    }


@pytest.fixture
def sample_shift_rows():
    return [
        {
            "timestamp"       : "2026-05-13 06:00:00",
            "shift_type"      : "day",
            "shift_start"     : "06:00",
            "total_runtime"   : "05:30:00",
            "total_stuck"     : "00:10:00",
            "total_no_feed"   : "00:20:00",
            "availability_pct": 91.7,
            "tonnage_actual"  : 120.0,
            "total_alerts"    : 2,
        },
        {
            "timestamp"       : "2026-05-12 18:00:00",
            "shift_type"      : "night",
            "shift_start"     : "18:00",
            "total_runtime"   : "04:00:00",
            "total_stuck"     : "00:30:00",
            "total_no_feed"   : "01:30:00",
            "availability_pct": 66.7,
            "tonnage_actual"  : 88.0,
            "total_alerts"    : 5,
        },
    ]


@pytest.fixture
def empty_shift_rows():
    return []


# ── PDF tests ─────────────────────────────────────────────────────────────

class TestBuildShiftPDF:

    def test_returns_bytes(self, sample_shift_rows, sample_live_state):
        result = build_shift_pdf(sample_shift_rows, sample_live_state)
        assert isinstance(result, bytes)

    def test_pdf_has_content(self, sample_shift_rows, sample_live_state):
        result = build_shift_pdf(sample_shift_rows, sample_live_state)
        assert len(result) > 1000  # a real PDF is always several KB

    def test_pdf_starts_with_pdf_header(self, sample_shift_rows, sample_live_state):
        result = build_shift_pdf(sample_shift_rows, sample_live_state)
        assert result[:4] == b"%PDF"

    def test_pdf_with_empty_shifts(self, empty_shift_rows, sample_live_state):
        """Should not crash when no shift rows exist."""
        result = build_shift_pdf(empty_shift_rows, sample_live_state)
        assert isinstance(result, bytes)
        assert result[:4] == b"%PDF"

    def test_pdf_with_minimal_live_state(self, sample_shift_rows):
        """Should not crash when live_state has missing keys."""
        minimal_state = {}
        result = build_shift_pdf(sample_shift_rows, minimal_state)
        assert isinstance(result, bytes)
        assert result[:4] == b"%PDF"

    def test_pdf_with_high_availability(self, sample_shift_rows):
        """High availability (≥85%) should use green colour — no crash."""
        state = {"availability_pct": 92.0, "timer_run": "08:00:00",
                 "timer_stuck": "00:00:00", "timer_no_feed": "00:00:00",
                 "session_start": "2026-05-13 06:00:00",
                 "last_active": "2026-05-13 14:00:00"}
        result = build_shift_pdf(sample_shift_rows, state)
        assert result[:4] == b"%PDF"

    def test_pdf_with_low_availability(self, sample_shift_rows):
        """Low availability (<65%) should use red colour — no crash."""
        state = {"availability_pct": 40.0, "timer_run": "04:00:00",
                 "timer_stuck": "01:00:00", "timer_no_feed": "03:00:00",
                 "session_start": "2026-05-13 06:00:00",
                 "last_active": "2026-05-13 14:00:00"}
        result = build_shift_pdf(sample_shift_rows, state)
        assert result[:4] == b"%PDF"

    def test_pdf_with_many_shifts(self, sample_live_state):
        """Should handle many shift rows without crashing."""
        rows = [
            {
                "timestamp": f"2026-05-{13-i:02d} 06:00:00",
                "shift_type": "day",
                "shift_start": "06:00",
                "total_runtime": "06:00:00",
                "total_stuck": "00:05:00",
                "total_no_feed": "00:10:00",
                "availability_pct": 90.0,
                "tonnage_actual": 100.0,
                "total_alerts": 1,
            }
            for i in range(20)
        ]
        result = build_shift_pdf(rows, sample_live_state)
        assert result[:4] == b"%PDF"


# ── CSV tests ─────────────────────────────────────────────────────────────

class TestBuildShiftCSV:

    def test_returns_string(self, sample_shift_rows, sample_live_state):
        result = build_shift_csv(sample_shift_rows, sample_live_state)
        assert isinstance(result, str)

    def test_csv_has_company_header(self, sample_shift_rows, sample_live_state):
        result = build_shift_csv(sample_shift_rows, sample_live_state)
        assert "Kannan Blue Metals" in result

    def test_csv_has_daily_summary(self, sample_shift_rows, sample_live_state):
        result = build_shift_csv(sample_shift_rows, sample_live_state)
        assert "Total Run Time" in result
        assert "06:30:00" in result

    def test_csv_has_shift_history_header(self, sample_shift_rows, sample_live_state):
        result = build_shift_csv(sample_shift_rows, sample_live_state)
        assert "timestamp" in result
        assert "shift_type" in result
        assert "availability_pct" in result

    def test_csv_contains_shift_data(self, sample_shift_rows, sample_live_state):
        result = build_shift_csv(sample_shift_rows, sample_live_state)
        assert "day" in result
        assert "night" in result
        assert "91.7" in result

    def test_csv_parseable_by_csv_reader(self, sample_shift_rows, sample_live_state):
        """The shift history section must be valid CSV."""
        result = build_shift_csv(sample_shift_rows, sample_live_state)
        # Extract only data rows (skip # comment lines)
        data_lines = [line for line in result.splitlines() if not line.startswith("#") and line.strip()]
        # Find the header row
        header_idx = next(
            (i for i, line in enumerate(data_lines) if "timestamp" in line), None
        )
        assert header_idx is not None, "No CSV header found"
        csv_section = "\n".join(data_lines[header_idx:])
        reader = csv.DictReader(io.StringIO(csv_section))
        rows = list(reader)
        assert len(rows) == 2
        assert rows[0]["shift_type"] == "day"

    def test_csv_without_live_state(self, sample_shift_rows):
        """Should work with live_state=None (no daily summary block)."""
        result = build_shift_csv(sample_shift_rows, live_state=None)
        assert "Kannan Blue Metals" in result
        assert "timestamp" in result
        # Daily summary should be absent
        assert "Total Run Time" not in result

    def test_csv_with_empty_shifts(self, sample_live_state):
        """Should produce valid output even with no shift rows."""
        result = build_shift_csv([], sample_live_state)
        assert isinstance(result, str)
        assert "Kannan Blue Metals" in result

    def test_csv_availability_in_output(self, sample_shift_rows, sample_live_state):
        result = build_shift_csv(sample_shift_rows, sample_live_state)
        assert "81.5" in result   # from live_state

    def test_csv_tonnage_in_output(self, sample_shift_rows, sample_live_state):
        result = build_shift_csv(sample_shift_rows, sample_live_state)
        assert "142.5" in result  # from live_state
