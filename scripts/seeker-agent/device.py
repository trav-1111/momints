#!/usr/bin/env python3
"""
ADB Device & Screen Interaction Harness for Solana Seeker.
Simulates human-like user actions and inspects UI hierarchy.
"""

import os
import re
import sys
import time
import random
import shutil
import subprocess
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import List, Optional, Callable, Tuple


@dataclass
class UIElement:
    """Represents a UI element from Android uiautomator dump."""
    text: str
    content_desc: str
    resource_id: str
    class_name: str
    bounds: Tuple[int, int, int, int]  # (x1, y1, x2, y2)
    center_x: int
    center_y: int
    clickable: bool
    enabled: bool
    focusable: bool
    scrollable: bool
    raw_node: ET.Element

    def matches(
        self,
        text: Optional[str] = None,
        desc: Optional[str] = None,
        resource_id: Optional[str] = None,
        partial: bool = True
    ) -> bool:
        """Check if this element matches the given criteria."""
        if text is not None:
            target = text.lower()
            elem_text = self.text.lower()
            if partial and target not in elem_text:
                return False
            if not partial and target != elem_text:
                return False

        if desc is not None:
            target = desc.lower()
            elem_desc = self.content_desc.lower()
            if partial and target not in elem_desc:
                return False
            if not partial and target != elem_desc:
                return False

        if resource_id is not None:
            if resource_id not in self.resource_id:
                return False

        return True

    def __repr__(self) -> str:
        attrs = []
        if self.text:
            attrs.append(f"text={self.text!r}")
        if self.content_desc:
            attrs.append(f"desc={self.content_desc!r}")
        if self.resource_id:
            attrs.append(f"id={self.resource_id!r}")
        attrs.append(f"bounds={self.bounds}")
        attrs.append(f"center=({self.center_x},{self.center_y})")
        return f"UIElement({', '.join(attrs)})"


class SeekerDevice:
    """High-level ADB controller for the physical Solana Seeker."""

    DEFAULT_SERIAL = "SM02G40619133790"
    DEFAULT_PACKAGE = "com.momints.app"
    DEFAULT_ACTIVITY = "com.momints.app.MainActivity"

    def __init__(self, serial: Optional[str] = None, adb_path: Optional[str] = None):
        self.serial = serial or os.environ.get("ANDROID_SERIAL") or self.DEFAULT_SERIAL
        self.adb = self._locate_adb(adb_path)
        self.package = self.DEFAULT_PACKAGE
        self.width = 1200
        self.height = 2670
        self._verify_connection()
        self._update_screen_size()

    def _locate_adb(self, custom_path: Optional[str]) -> str:
        if custom_path and os.path.exists(custom_path):
            return custom_path
        which_adb = shutil.which("adb")
        if which_adb:
            return which_adb
        fallback = os.path.expanduser("~/Library/Android/sdk/platform-tools/adb")
        if os.path.exists(fallback):
            return fallback
        raise RuntimeError("ADB binary could not be found in PATH or standard Android SDK locations.")

    def run_adb(self, args: List[str], timeout: float = 15.0) -> str:
        cmd = [self.adb, "-s", self.serial] + args
        try:
            res = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=True,
                timeout=timeout
            )
            return res.stdout
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"ADB command failed: {' '.join(cmd)}\nstderr: {e.stderr}")
        except subprocess.TimeoutExpired:
            raise TimeoutError(f"ADB command timed out after {timeout}s: {' '.join(cmd)}")

    def run_adb_bytes(self, args: List[str], timeout: float = 20.0) -> bytes:
        cmd = [self.adb, "-s", self.serial] + args
        res = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
            timeout=timeout
        )
        return res.stdout

    def run_shell(self, shell_cmd: str, timeout: float = 15.0) -> str:
        return self.run_adb(["shell", shell_cmd], timeout=timeout)

    def _verify_connection(self):
        devices = self.run_adb(["devices"]).strip().splitlines()
        found = False
        for line in devices[1:]:
            parts = line.split()
            if len(parts) >= 2 and parts[0] == self.serial:
                if parts[1] == "device":
                    found = True
                    break
                else:
                    raise RuntimeError(f"Device {self.serial} is in state '{parts[1]}' (expected 'device').")
        if not found:
            raise RuntimeError(f"Solana Seeker device {self.serial} is not connected.")

    def _update_screen_size(self):
        try:
            out = self.run_shell("wm size")
            m = re.search(r"Physical size:\s*(\d+)x(\d+)", out)
            if m:
                self.width = int(m.group(1))
                self.height = int(m.group(2))
        except Exception:
            pass

    def wake_and_unlock(self):
        """Ensure device screen is on and unlocked."""
        out = self.run_shell("dumpsys power | grep mWakefulness=")
        if "Awake" not in out:
            self.run_shell("input keyevent KEYCODE_WAKEUP")
            time.sleep(0.5)
        self.run_shell("wm dismiss-keyguard")
        time.sleep(0.3)

    def is_app_foreground(self) -> bool:
        """Check if com.momints.app is currently in the foreground."""
        out = self.run_shell("dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'")
        return self.package in out

    def launch_app(self, wait_seconds: float = 2.0):
        """Launch the app and wait for activity to focus."""
        self.wake_and_unlock()
        self.run_shell(f"am start -n {self.package}/{self.DEFAULT_ACTIVITY}")
        time.sleep(wait_seconds)

    # ──────────────────────────────────────────────────────────────────────────
    # UI Hierarchy & Inspection
    # ──────────────────────────────────────────────────────────────────────────

    def dump_hierarchy(self) -> List[UIElement]:
        """Dump the UI hierarchy via uiautomator and parse all elements."""
        tmp_remote = "/data/local/tmp/seeker_agent_dump.xml"
        self.run_shell(f"uiautomator dump {tmp_remote}")
        xml_content = self.run_shell(f"cat {tmp_remote}")
        return self._parse_xml_hierarchy(xml_content)

    def _parse_xml_hierarchy(self, xml_str: str) -> List[UIElement]:
        elements: List[UIElement] = []
        if not xml_str.strip():
            return elements

        try:
            root = ET.fromstring(xml_str)
        except ET.ParseError:
            return elements

        bounds_re = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")

        for node in root.iter("node"):
            b_str = node.attrib.get("bounds", "")
            m = bounds_re.match(b_str)
            if not m:
                continue

            x1, y1, x2, y2 = map(int, m.groups())
            cx = (x1 + x2) // 2
            cy = (y1 + y2) // 2

            text = node.attrib.get("text", "")
            desc = node.attrib.get("content-desc", "")
            res_id = node.attrib.get("resource-id", "")
            cls_name = node.attrib.get("class", "")
            clickable = node.attrib.get("clickable", "false") == "true"
            enabled = node.attrib.get("enabled", "true") == "true"
            focusable = node.attrib.get("focusable", "false") == "true"
            scrollable = node.attrib.get("scrollable", "false") == "true"

            elem = UIElement(
                text=text,
                content_desc=desc,
                resource_id=res_id,
                class_name=cls_name,
                bounds=(x1, y1, x2, y2),
                center_x=cx,
                center_y=cy,
                clickable=clickable,
                enabled=enabled,
                focusable=focusable,
                scrollable=scrollable,
                raw_node=node,
            )
            elements.append(elem)

        return elements

    def find_elements(
        self,
        text: Optional[str] = None,
        desc: Optional[str] = None,
        resource_id: Optional[str] = None,
        clickable_only: bool = False,
        partial: bool = True
    ) -> List[UIElement]:
        """Find all elements on screen matching the criteria."""
        elements = self.dump_hierarchy()
        results: List[UIElement] = []
        for elem in elements:
            if clickable_only and not elem.clickable:
                continue
            if elem.matches(text=text, desc=desc, resource_id=resource_id, partial=partial):
                results.append(elem)
        return results

    def find_element(
        self,
        text: Optional[str] = None,
        desc: Optional[str] = None,
        resource_id: Optional[str] = None,
        clickable_only: bool = False,
        partial: bool = True
    ) -> Optional[UIElement]:
        """Find first element matching criteria."""
        elems = self.find_elements(text=text, desc=desc, resource_id=resource_id, clickable_only=clickable_only, partial=partial)
        return elems[0] if elems else None

    def wait_for_element(
        self,
        text: Optional[str] = None,
        desc: Optional[str] = None,
        timeout: float = 6.0,
        poll_interval: float = 0.5
    ) -> Optional[UIElement]:
        """Poll the screen hierarchy until an element appears or timeout occurs."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            elem = self.find_element(text=text, desc=desc)
            if elem:
                return elem
            time.sleep(poll_interval)
        return None

    # ──────────────────────────────────────────────────────────────────────────
    # Human-Like Touch & Gesture Simulator
    # ──────────────────────────────────────────────────────────────────────────

    def tap(self, x: int, y: int, jitter: int = 3, human_delay: float = 0.2):
        """
        Simulate a human finger tap with subtle coordinate jitter and natural delay.
        """
        jx = x + random.randint(-jitter, jitter)
        jy = y + random.randint(-jitter, jitter)
        # Keep within bounds
        jx = max(0, min(self.width - 1, jx))
        jy = max(0, min(self.height - 1, jy))
        self.run_shell(f"input tap {jx} {jy}")
        if human_delay > 0:
            # Add slight randomized pause
            time.sleep(human_delay + random.uniform(0.05, 0.15))

    def tap_element(self, element: UIElement, human_delay: float = 0.2):
        """Tap at the center of a UI element."""
        self.tap(element.center_x, element.center_y, human_delay=human_delay)

    def swipe(
        self,
        x1: int,
        y1: int,
        x2: int,
        y2: int,
        duration_ms: int = 300,
        human_delay: float = 0.3
    ):
        """
        Simulate a human swipe gesture.
        """
        self.run_shell(f"input swipe {x1} {y1} {x2} {y2} {duration_ms}")
        if human_delay > 0:
            time.sleep(human_delay + random.uniform(0.05, 0.1))

    def press_back(self, human_delay: float = 0.5):
        """Press Android BACK hardware/virtual button."""
        self.run_shell("input keyevent KEYCODE_BACK")
        time.sleep(human_delay)

    def screenshot(self, dest_path: str):
        """Capture screenshot directly via exec-out screencap."""
        os.makedirs(os.path.dirname(os.path.abspath(dest_path)), exist_ok=True)
        img_bytes = self.run_adb_bytes(["exec-out", "screencap", "-p"])
        with open(dest_path, "wb") as f:
            f.write(img_bytes)
