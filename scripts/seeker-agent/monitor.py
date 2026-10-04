#!/usr/bin/env python3
"""
Performance, Memory & Logcat Auditor for Momints on Solana Seeker.
Tracks dumpsys meminfo (PSS, Native Heap, Graphics) and monitors logcat for errors.
"""

import re
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional
try:
    from .device import SeekerDevice
except (ImportError, ValueError):
    from device import SeekerDevice



@dataclass
class MemorySnapshot:
    timestamp: float
    total_pss_kb: int = 0
    native_heap_kb: int = 0
    java_heap_kb: int = 0
    graphics_kb: int = 0
    total_rss_kb: int = 0
    views: int = 0
    activities: int = 0

    @property
    def total_pss_mb(self) -> float:
        return self.total_pss_kb / 1024.0

    @property
    def native_heap_mb(self) -> float:
        return self.native_heap_kb / 1024.0

    @property
    def java_heap_mb(self) -> float:
        return self.java_heap_kb / 1024.0

    @property
    def graphics_mb(self) -> float:
        return self.graphics_kb / 1024.0

    def format_summary(self) -> str:
        return (
            f"TOTAL PSS: {self.total_pss_mb:.1f} MB | "
            f"Native: {self.native_heap_mb:.1f} MB | "
            f"Java: {self.java_heap_mb:.1f} MB | "
            f"Graphics: {self.graphics_mb:.1f} MB"
        )


class SystemAuditor:
    """Monitors Android dumpsys meminfo and logcat during automated testing."""

    APP_TAGS = [
        "com.momints.app",
        "FilmGlModule",
        "CameraManual",
        "ReactNativeJS",
        "VisionCamera",
        "MtkCam",
    ]

    ERROR_PATTERNS = [
        re.compile(r"FATAL EXCEPTION", re.IGNORECASE),
        re.compile(r"ReactNativeJS:.*Error:", re.IGNORECASE),
        re.compile(r"OutOfMemoryError", re.IGNORECASE),
        re.compile(r"Fatal signal \d+", re.IGNORECASE),
        re.compile(r"ANR in com\.momints\.app", re.IGNORECASE),
    ]

    def __init__(self, device: SeekerDevice):
        self.device = device
        self.snapshots: List[MemorySnapshot] = []

    def capture_memory_snapshot(self) -> MemorySnapshot:
        """Query dumpsys meminfo and return structured snapshot."""
        out = self.device.run_shell(f"dumpsys meminfo {self.device.package}")
        snap = MemorySnapshot(timestamp=time.time())

        for line in out.splitlines():
            # App Summary table
            if "TOTAL PSS:" in line:
                m = re.search(r"TOTAL PSS:\s+(\d+)", line)
                if m:
                    snap.total_pss_kb = int(m.group(1))
            if "TOTAL RSS:" in line:
                m = re.search(r"TOTAL RSS:\s+(\d+)", line)
                if m:
                    snap.total_rss_kb = int(m.group(1))
            if "Java Heap:" in line:
                m = re.search(r"Java Heap:\s+(\d+)", line)
                if m:
                    snap.java_heap_kb = int(m.group(1))
            if "Native Heap:" in line:
                m = re.search(r"Native Heap:\s+(\d+)", line)
                if m:
                    snap.native_heap_kb = int(m.group(1))
            if "Graphics:" in line:
                m = re.search(r"Graphics:\s+(\d+)", line)
                if m:
                    snap.graphics_kb = int(m.group(1))
            if "Views:" in line:
                m = re.search(r"Views:\s+(\d+)", line)
                if m:
                    snap.views = int(m.group(1))
            if "Activities:" in line:
                m = re.search(r"Activities:\s+(\d+)", line)
                if m:
                    snap.activities = int(m.group(1))

        self.snapshots.append(snap)
        return snap

    def get_logcat_dump(self, lines_count: int = 500) -> str:
        """Get recent logcat lines for app tags."""
        return self.device.run_adb(["logcat", "-d", "-t", str(lines_count)])

    def clear_logcat(self):
        """Clear current logcat buffer."""
        try:
            self.device.run_adb(["logcat", "-c"])
        except Exception:
            pass

    def scan_for_critical_errors(self, logcat_text: str) -> List[str]:
        """Scan logcat output for critical errors, crashes, and exceptions."""
        found_errors = []
        for line in logcat_text.splitlines():
            for pattern in self.ERROR_PATTERNS:
                if pattern.search(line):
                    found_errors.append(line.strip())
                    break
        return found_errors

    def compute_memory_delta(self, baseline: MemorySnapshot, current: MemorySnapshot) -> Dict[str, float]:
        """Compute delta in MB between baseline and current snapshot."""
        return {
            "pss_delta_mb": current.total_pss_mb - baseline.total_pss_mb,
            "native_delta_mb": current.native_heap_mb - baseline.native_heap_mb,
            "java_delta_mb": current.java_heap_mb - baseline.java_heap_mb,
            "graphics_delta_mb": current.graphics_mb - baseline.graphics_mb,
        }
