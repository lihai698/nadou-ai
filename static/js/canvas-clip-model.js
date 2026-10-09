/* Native single-track clip data. Times are integer frames at 30fps.
 * All editing methods return a detached JSON snapshot; they never write a canvas.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CanvasClipModel = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const FPS = 30;
  let serial = 0;
  const copy = value => JSON.parse(JSON.stringify(value));
  const integer = value => Math.round(Number(value));
  const sortClips = data => data.clips.sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
  const sourceKey = clip => JSON.stringify([clip.sourceNodeId || '', clip.sourceResultId || clip.url]);
  const length = clip => clip.endFrame - clip.startFrame;

  function createData() {
    return { version: 1, fps: FPS, clips: [], selectedClipId: null, excludedSources: [], exportMuted: false };
  }

  function snapshot(data) {
    return data ? copy(data) : createData();
  }

  function newId(data) {
    let id;
    do {
      id = `clip-${Date.now().toString(36)}-${(++serial).toString(36)}`;
    } while (data.clips.some(clip => clip.id === id));
    return id;
  }

  function durationFrames(data) {
    return (data.clips || []).reduce((max, clip) => Math.max(max, clip.endFrame), 0);
  }

  function addMedia(data, media, options = {}) {
    const next = snapshot(data);
    if (!media || !['image', 'video'].includes(media.kind) || typeof media.url !== 'string' || !media.url.trim()) return next;
    const sourceNodeId = String(media.sourceNodeId || '');
    const sourceResultId = String(media.sourceResultId || media.url);
    const key = sourceKey({ sourceNodeId, sourceResultId });
    if (options.manual) next.excludedSources = next.excludedSources.filter(item => item !== key);
    if (next.excludedSources.includes(key) || next.clips.some(clip => sourceKey(clip) === key)) return next;
    const seconds = Number(media.durationSeconds);
    const confirmed = Number.isFinite(seconds) && seconds > 0;
    const fallback = media.kind === 'image' && !media.fromUpstream ? 4 : 6;
    const duration = Math.max(1, Math.round((confirmed ? seconds : fallback) * FPS));
    const startFrame = durationFrames(next);
    const clip = {
      id: newId(next), sourceNodeId, sourceResultId,
      kind: media.kind, url: media.url, posterUrl: String(media.posterUrl || ''), name: String(media.name || ''),
      sourceDurationFrames: duration, sourceOffsetFrames: 0,
      startFrame, endFrame: startFrame + duration,
      durationUnconfirmed: !confirmed && (media.kind === 'video' || !!media.fromUpstream)
    };
    next.clips.push(clip);
    next.selectedClipId = clip.id;
    return next;
  }

  function syncSources(data, sources) {
    return (sources || []).reduce((next, media) => addMedia(next, { ...media, fromUpstream: true }), snapshot(data));
  }

  function split(data, id, frame) {
    const next = snapshot(data);
    const clip = next.clips.find(item => item.id === id);
    const at = integer(frame);
    if (!clip || !Number.isFinite(at) || at <= clip.startFrame || at >= clip.endFrame) return next;
    const right = { ...clip, id: newId(next), startFrame: at, sourceOffsetFrames: clip.sourceOffsetFrames + at - clip.startFrame };
    clip.endFrame = at;
    next.clips.push(right);
    sortClips(next);
    next.selectedClipId = right.id;
    return next;
  }

  // Project the requested start into every gap that can hold the entire clip.
  // This allows gaps while preventing overlap; ties prefer the earlier position.
  function placement(clips, size, requested) {
    const ordered = [...clips].sort((a, b) => a.startFrame - b.startFrame);
    const candidates = [];
    let left = 0;
    for (const clip of ordered) {
      if (clip.startFrame - left >= size) candidates.push(Math.min(Math.max(requested, left), clip.startFrame - size));
      left = Math.max(left, clip.endFrame);
    }
    candidates.push(Math.max(left, requested));
    candidates.sort((a, b) => Math.abs(a - requested) - Math.abs(b - requested) || a - b);
    return candidates[0];
  }

  function duplicate(data, id) {
    const next = snapshot(data);
    const original = next.clips.find(clip => clip.id === id);
    if (!original) return next;
    const startFrame = placement(next.clips, length(original), original.endFrame);
    const clip = { ...original, id: newId(next), startFrame, endFrame: startFrame + length(original) };
    next.clips.push(clip);
    sortClips(next);
    next.selectedClipId = clip.id;
    return next;
  }

  function remove(data, id) {
    const next = snapshot(data);
    sortClips(next);
    const index = next.clips.findIndex(clip => clip.id === id);
    if (index < 0) return next;
    const [removed] = next.clips.splice(index, 1);
    const key = sourceKey(removed);
    if (!next.clips.some(clip => sourceKey(clip) === key) && !next.excludedSources.includes(key)) next.excludedSources.push(key);
    let start = 0;
    for (const clip of next.clips) {
      const size = length(clip);
      clip.startFrame = start;
      clip.endFrame = start + size;
      start = clip.endFrame;
    }
    if (next.selectedClipId === id || !next.clips.some(clip => clip.id === next.selectedClipId)) {
      next.selectedClipId = next.clips[Math.min(index, next.clips.length - 1)]?.id || null;
    }
    return next;
  }

  function move(data, id, start, options = {}) {
    const next = snapshot(data);
    const clip = next.clips.find(item => item.id === id);
    const requested = integer(start);
    if (!clip || !Number.isFinite(requested)) return next;
    const others = next.clips.filter(item => item.id !== id);
    const size = length(clip);
    let at = Math.max(0, requested);
    if (!options.disableSnap) {
      const threshold = Number.isFinite(Number(options.thresholdFrames)) ? Math.max(0, Number(options.thresholdFrames)) : 5;
      const targets = [0, ...others.flatMap(item => [item.startFrame, item.endFrame])];
      if (options.snapFrame != null && Number.isFinite(Number(options.snapFrame))) targets.push(integer(options.snapFrame));
      const candidates = targets.flatMap(target => [target, target - size])
        .filter(candidate => candidate >= 0 && Math.abs(candidate - at) <= threshold && placement(others, size, candidate) === candidate)
        .sort((a, b) => Math.abs(a - at) - Math.abs(b - at) || a - b);
      if (candidates.length) at = candidates[0];
    }
    clip.startFrame = placement(others, size, at);
    clip.endFrame = clip.startFrame + size;
    sortClips(next);
    return next;
  }

  function trim(data, id, side, frame) {
    const next = snapshot(data);
    sortClips(next);
    const index = next.clips.findIndex(clip => clip.id === id);
    const at = integer(frame);
    if (index < 0 || !Number.isFinite(at) || !['left', 'right'].includes(side)) return next;
    const clip = next.clips[index];
    if (side === 'left') {
      let min = index ? next.clips[index - 1].endFrame : 0;
      if (clip.kind === 'video') min = Math.max(min, clip.startFrame - clip.sourceOffsetFrames);
      const start = Math.min(Math.max(at, min), clip.endFrame - 1);
      clip.sourceOffsetFrames = Math.max(0, clip.sourceOffsetFrames + start - clip.startFrame);
      clip.startFrame = start;
    } else {
      let max = index + 1 < next.clips.length ? next.clips[index + 1].startFrame : Infinity;
      if (clip.kind === 'video') max = Math.min(max, clip.startFrame + clip.sourceDurationFrames - clip.sourceOffsetFrames);
      clip.endFrame = Math.max(clip.startFrame + 1, Math.min(at, max));
    }
    return next;
  }

  function exportTasks(data, scope = 'full') {
    const next = snapshot(data);
    sortClips(next);
    if (!next.clips.length) return [];
    if (scope !== 'segments') return [{ sourceClipId: null, name: '完整成片', clipData: next }];
    return next.clips.map((clip, index) => {
      const part = snapshot(next);
      part.clips = [{ ...clip, startFrame: 0, endFrame: length(clip) }];
      part.selectedClipId = clip.id;
      return { sourceClipId: clip.id, name: `片段${String(index + 1).padStart(2, '0')}`, clipData: part };
    });
  }

  function remap(data, idMap = {}) {
    const next = snapshot(data);
    const mapped = id => {
      const value = typeof idMap.get === 'function' ? idMap.get(id) : Object.prototype.hasOwnProperty.call(idMap, id) ? idMap[id] : undefined;
      return value == null ? id : String(value);
    };
    for (const clip of next.clips) {
      const oldId = clip.id;
      clip.id = newId(next);
      clip.sourceNodeId = mapped(clip.sourceNodeId);
      if (next.selectedClipId === oldId) next.selectedClipId = clip.id;
    }
    next.excludedSources = [...new Set(next.excludedSources.map(key => {
      try {
        const pair = JSON.parse(key);
        if (Array.isArray(pair) && pair.length === 2) return JSON.stringify([mapped(pair[0]), pair[1]]);
      } catch (_) { /* Keep unknown legacy keys rather than resurrecting excluded sources. */ }
      return key;
    }))];
    return next;
  }

  return { createData, addMedia, syncSources, durationFrames, split, duplicate, remove, move, trim, exportTasks, remap };
});
