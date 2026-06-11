#!/usr/bin/env python3
"""Synthesize the car's audio track from lap telemetry and mux it into the video.

Brushless motor whine (pitch follows motor RPM, level follows throttle/brake),
tire scrub noise driven by combined slip saturation, and speed-dependent
wind/rolling noise.

Usage: python3 tools/make_audio.py telemetry.json video.mp4 out.mp4 [max_laps]
"""
import json
import math
import subprocess
import sys
import wave

import numpy as np
import imageio_ffmpeg

FS = 44100


def synth(telemetry_path, max_laps=None):
    data = json.load(open(telemetry_path))
    frames = data["frames"]
    if max_laps is not None:
        frames = [f for f in frames if f["lap"] <= max_laps]
    fps = data["fps"]
    n_fr = len(frames)
    dur = n_fr / fps
    n = int(dur * FS)
    tf = np.arange(n_fr) / fps
    ta = np.arange(n) / FS

    rpm = np.interp(ta, tf, [f.get("rpm", 0) for f in frames])
    thr = np.interp(ta, tf, [f["thr"] for f in frames])
    brk = np.interp(ta, tf, [f["brk"] for f in frames])
    slip = np.interp(ta, tf, [f.get("slip", 0) for f in frames])
    v = np.interp(ta, tf, [f["v"] for f in frames])

    rng = np.random.default_rng(3)

    # --- motor whine: pitch ~ rpm, slight PWM shimmer ---
    f0 = rpm / 60.0 * 3.0  # "3rd order" whine, sweeps ~0-2.3 kHz
    phase = 2 * np.pi * np.cumsum(f0) / FS
    shimmer = 1 + 0.004 * np.sin(2 * np.pi * 37 * ta)
    motor = (0.55 * np.sin(phase * shimmer)
             + 0.30 * np.sin(2 * phase)
             + 0.18 * np.sin(3 * phase)
             + 0.10 * np.sin(6 * phase))
    motor = np.tanh(2.0 * motor)
    spin = np.clip(rpm / 4000.0, 0, 1)
    motor_amp = (0.10 + 0.50 * thr + 0.30 * brk) * spin
    motor *= motor_amp * 0.55

    # --- tire scrub: low-passed noise gated by slip saturation ---
    noise = rng.standard_normal(n).astype(np.float32)
    scrub = np.empty_like(noise)
    a = 0.18  # one-pole lowpass ~1.4 kHz
    acc = 0.0
    for i in range(n):  # simple IIR (vectorize via lfilter-free loop is slow; chunk)
        acc += a * (noise[i] - acc)
        scrub[i] = acc
    env = np.clip((slip - 0.85) / 0.7, 0, 1) ** 1.4 * np.clip(v / 6.0, 0, 1)
    scrub *= env * 0.9

    # --- wind / rolling ---
    wind_n = rng.standard_normal(n).astype(np.float32)
    wnd = np.empty_like(wind_n)
    acc = 0.0
    for i in range(n):
        acc += 0.05 * (wind_n[i] - acc)
        wnd[i] = acc
    wnd *= 0.5 * (v / 30.0) ** 2

    mix = motor + scrub + wnd
    mix = np.tanh(1.4 * mix)
    mix *= 0.8 / max(1e-6, np.abs(mix).max())

    # gentle stereo: slight high-frequency decorrelation
    left = mix
    right = np.roll(mix, 13)
    pcm = np.stack([left, right], axis=1)
    return (pcm * 32767).astype(np.int16)


def main():
    tel = sys.argv[1]
    vid = sys.argv[2]
    out = sys.argv[3]
    laps = int(sys.argv[4]) if len(sys.argv) > 4 else None

    pcm = synth(tel, laps)
    wav_path = "/tmp/car_audio.wav"
    with wave.open(wav_path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(FS)
        w.writeframes(pcm.tobytes())
    print(f"Synthesized {pcm.shape[0]/FS:.1f} s of audio")

    ff = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([ff, "-y", "-i", vid, "-i", wav_path,
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
                    "-shortest", out], check=True, capture_output=True)
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
