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


def lowpass(x, a):
    """One-pole lowpass, vectorized via scipy-free recursion in chunks."""
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a * (x[i] - acc)
        y[i] = acc
    return y


def synth(telemetry_path, max_laps=None):
    """Belt-drive RC car heard from the driver's stand: smooth motor/spur
    whine with Doppler, belt whirr, slip-gated tire scrub, distance + pan."""
    data = json.load(open(telemetry_path))
    frames = data["frames"]
    if max_laps is not None:
        frames = [f for f in frames if f["lap"] <= max_laps]
    fps = data["fps"]
    stand = data["track"]["stand"]
    n_fr = len(frames)
    n = int(n_fr / fps * FS)
    tf = np.arange(n_fr) / fps
    ta = np.arange(n) / FS

    rpm = np.interp(ta, tf, [f.get("rpm", 0) for f in frames])
    thr = np.interp(ta, tf, [f["thr"] for f in frames])
    brk = np.interp(ta, tf, [f["brk"] for f in frames])
    slip = np.interp(ta, tf, [f.get("slip", 0) for f in frames])
    v = np.interp(ta, tf, [f["v"] for f in frames])
    xs = np.array([f["x"] for f in frames])
    ys = np.array([f["y"] for f in frames])
    dist_f = np.sqrt((xs - stand["x"]) ** 2 + (ys - stand["y"]) ** 2 + stand["z"] ** 2)
    vrad_f = np.gradient(dist_f) * fps
    dist = np.interp(ta, tf, dist_f)
    vrad = np.interp(ta, tf, vrad_f)
    pan = np.clip(np.interp(ta, tf, (xs - stand["x"])) / 14.0, -1, 1)

    rng = np.random.default_rng(3)
    spin = np.clip(rpm / 5000.0, 0, 1)
    doppler = 1.0 / (1.0 + vrad / 343.0)

    # --- motor / spur whine: bright fast-sweeping EP tone, two detuned voices ---
    f0 = rpm / 60.0 * 3.2 * doppler
    ph1 = 2 * np.pi * np.cumsum(f0) / FS
    ph2 = 2 * np.pi * np.cumsum(f0 * 1.006) / FS
    def voice(ph):
        return (np.sin(ph) + 0.70 * np.sin(2 * ph) + 0.45 * np.sin(3 * ph)
                + 0.30 * np.sin(4 * ph) + 0.16 * np.sin(5 * ph))
    motor = 0.6 * voice(ph1) + 0.4 * voice(ph2)
    motor = np.tanh(1.05 * motor) * 0.5
    # remove low-frequency mud: EP whine has almost no bass content
    motor -= lowpass(motor.astype(np.float32), 0.04)
    # fast attack on throttle stabs, slightly slower release
    motor *= (0.05 + 0.55 * thr ** 0.8 + 0.22 * brk) * spin

    # --- belt whirr: noise amplitude-modulated at belt frequency ---
    fbelt = rpm / 60.0 * 0.5 * doppler
    phb = 2 * np.pi * np.cumsum(np.maximum(fbelt, 1)) / FS
    whirr = lowpass(rng.standard_normal(n).astype(np.float32), 0.30)
    whirr *= (0.55 + 0.45 * np.sin(phb)) * spin * (0.25 + 0.5 * thr) * 0.30

    # --- tire scrub: soft "shhh" only at true slip saturation ---
    scrub = lowpass(rng.standard_normal(n).astype(np.float32), 0.10)
    env = np.clip((slip - 0.95) / 0.55, 0, 1) ** 1.6 * np.clip(v / 6.0, 0, 1)
    scrub *= env * 0.55

    # --- wind + faint outdoor ambience ---
    wnd = lowpass(rng.standard_normal(n).astype(np.float32), 0.04)
    wnd = wnd * (0.30 * (v / 30.0) ** 2) + wnd * 0.012

    # distance attenuation from the stand
    gdist = np.clip(5.5 / dist, 0.18, 1.0)
    mix = (motor + whirr + scrub) * gdist + wnd
    mix = np.tanh(1.1 * mix)
    mix = lowpass(mix.astype(np.float32), 0.78)  # keep the EP top-end crisp
    mix *= 0.65 / max(1e-6, np.abs(mix).max())

    left = mix * np.sqrt(0.5 * (1 - 0.8 * pan))
    right = mix * np.sqrt(0.5 * (1 + 0.8 * pan))
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
