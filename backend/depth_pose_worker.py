"""从同一原视频导出独立姿态视频和逐帧关键点；由隔离运行组件启动。"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys

import cv2
import mediapipe as mp
import numpy as np


LANDMARK_NAMES = (
    "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner",
    "right_eye", "right_eye_outer", "left_ear", "right_ear", "mouth_left",
    "mouth_right", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index",
    "right_index", "left_thumb", "right_thumb", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle", "left_heel",
    "right_heel", "left_foot_index", "right_foot_index",
)

# MediaPipe 33 点骨架；各关节下标与 LANDMARK_NAMES 一致。
CONNECTIONS = (
    (0, 1), (1, 2), (2, 3), (0, 4), (4, 5), (5, 6), (3, 7), (6, 8),
    (9, 10), (11, 12), (11, 13), (13, 15), (15, 17), (17, 19),
    (19, 15), (15, 21), (12, 14), (14, 16), (16, 18), (18, 20),
    (20, 16), (16, 22), (11, 23), (12, 24), (23, 24), (23, 25),
    (25, 27), (27, 29), (29, 31), (27, 31), (24, 26), (26, 28),
    (28, 30), (30, 32), (28, 32),
)


def point_values(point):
    return [round(float(point.x), 6), round(float(point.y), 6),
            round(float(point.z), 6), round(float(point.visibility or 0), 4),
            round(float(point.presence or 0), 4)]


def draw_pose(frame, landmarks):
    height, width = frame.shape[:2]
    points = [(round(p.x * width), round(p.y * height)) for p in landmarks]
    visible = [p.visibility >= .45 and p.presence >= .45 for p in landmarks]
    for a, b in CONNECTIONS:
        if visible[a] and visible[b]:
            cv2.line(frame, points[a], points[b], (255, 210, 80), 3, cv2.LINE_AA)
    for index, xy in enumerate(points):
        if visible[index]:
            cv2.circle(frame, xy, 4, (255, 255, 255), -1, cv2.LINE_AA)


def run(source: Path, model: Path, video: Path, data: Path, fps: float, count: int,
        width: int, height: int, ffmpeg: Path):
    if count < 1 or not 0 < fps <= 30 or width < 2 or height < 2:
        raise ValueError("姿态输出参数无效")
    if not source.is_file() or not model.is_file():
        raise FileNotFoundError("原视频或姿态模型不存在")
    video.parent.mkdir(parents=True, exist_ok=True)
    data.parent.mkdir(parents=True, exist_ok=True)
    base = mp.tasks.BaseOptions(model_asset_path=str(model))
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=base, running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_poses=2, min_pose_detection_confidence=.5,
        min_pose_presence_confidence=.5, min_tracking_confidence=.5,
    )
    raw_frame_size = width * height * 3
    decode = subprocess.Popen([
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-i", str(source),
        "-vf", f"fps={fps:.9f},scale={width}:{height}", "-frames:v", str(count),
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    encode = subprocess.Popen([
        str(ffmpeg), "-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo",
        "-pixel_format", "bgr24", "-video_size", f"{width}x{height}",
        "-framerate", f"{fps:.9f}", "-i", "-", "-an", "-c:v", "libx264",
        "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(video),
    ], stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    records = []
    detected = 0
    try:
        with mp.tasks.vision.PoseLandmarker.create_from_options(options) as landmarker:
            for index in range(count):
                raw = decode.stdout.read(raw_frame_size)
                if len(raw) != raw_frame_size:
                    raise RuntimeError(f"姿态视频帧不足：{index}/{count}")
                rgb = np.frombuffer(raw, np.uint8).reshape(height, width, 3)
                timestamp_ms = round(index * 1000 / fps)
                result = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), timestamp_ms)
                canvas = np.zeros((height, width, 3), np.uint8)
                poses = []
                for landmarks, world in zip(result.pose_landmarks, result.pose_world_landmarks):
                    draw_pose(canvas, landmarks)
                    poses.append({"landmarks": [point_values(p) for p in landmarks],
                                  "world_landmarks": [point_values(p) for p in world]})
                if poses:
                    detected += 1
                records.append({"frame": index, "time_ms": timestamp_ms, "poses": poses})
                encode.stdin.write(canvas.tobytes())
                if index % 30 == 0:
                    print(f"姿态分析 {index + 1}/{count}", flush=True)
        encode.stdin.close()
        if encode.wait() != 0 or decode.wait() != 0:
            raise RuntimeError("姿态视频解码或编码失败")
        data.write_text(json.dumps({"format": "mediapipe-pose-33", "fps": fps,
                                   "width": width, "height": height,
                                   "landmarks": LANDMARK_NAMES, "frames": records},
                                   ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"姿态识别完成 {detected}/{count} 帧", flush=True)
    finally:
        if decode.poll() is None:
            decode.kill()
        if encode.poll() is None:
            encode.kill()
        decode.wait()
        encode.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--fps", type=float, required=True)
    parser.add_argument("--count", type=int, required=True)
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    parser.add_argument("--ffmpeg", type=Path, required=True)
    args = parser.parse_args()
    try:
        run(args.source, args.model, args.video, args.data, args.fps, args.count,
            args.width, args.height, args.ffmpeg)
    except Exception as exc:
        print(f"姿态处理失败：{exc}", file=sys.stderr)
        raise SystemExit(1)
