"use strict";

// Pure helpers shared by the sidecar and its tests. No I/O here.

const NOISE = /\s*[\[(](?:official\s+)?(?:music\s+)?(?:video|audio|lyrics?|visuali[sz]er|mv|hd|hq|4k|remaster(?:ed)?|explicit)[^\])]*[\])]/gi;

function cleanTitle(value) {
  return String(value || "")
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitArtistTitle(value) {
  const text = cleanTitle(value);
  const match = text.match(/^(.+?)\s+-\s+(.+)$/);
  if (match) return { artist: match[1].trim(), title: match[2].trim() };
  return { artist: "", title: text };
}

function cleanArtist(value) {
  return String(value || "").replace(/\s*-\s*Topic$/i, "").trim();
}

function normalizeTrack(raw, fallbackUrl) {
  const entry = raw || {};
  const id = entry.id ? String(entry.id) : "";
  const rawTitle = entry.track || entry.title || "";
  const split = splitArtistTitle(rawTitle);
  const uploader = cleanArtist(entry.artist || entry.creator || entry.uploader || entry.channel || "");
  let title = cleanTitle(entry.title) || "Unknown";
  let artist = uploader;

  if (entry.track) {
    title = cleanTitle(entry.track) || "Unknown";
  } else if (split.artist && (!uploader || split.artist.toLowerCase() === uploader.toLowerCase())) {
    title = split.title || "Unknown";
    artist = split.artist;
  }
  const url = entry.webpage_url || entry.original_url ||
    (entry.url && /^https?:\/\//i.test(entry.url) ? entry.url : "") ||
    (id ? "https://www.youtube.com/watch?v=" + id : (fallbackUrl || ""));
  const thumbnail = entry.thumbnail ||
    (Array.isArray(entry.thumbnails) && entry.thumbnails.length
      ? entry.thumbnails[entry.thumbnails.length - 1].url
      : "") ||
    (id ? "https://i.ytimg.com/vi/" + id + "/mqdefault.jpg" : "");
  return {
    id: id || url,
    videoId: id,
    title,
    artist,
    album: entry.album || "",
    duration: Number(entry.duration) || 0,
    thumbnail,
    url,
    source: "youtube",
  };
}

function normalizeList(payload, fallbackUrl) {
  const entries = payload && Array.isArray(payload.entries)
    ? payload.entries
    : (payload ? [payload] : []);
  return entries
    .filter((entry) => entry && (entry.id || entry.url || entry.webpage_url))
    .map((entry) => normalizeTrack(entry, fallbackUrl));
}

function normalizeSearch(payload, limit) {
  const list = normalizeList(payload, "");
  return Number(limit) > 0 ? list.slice(0, limit) : list;
}

class Queue {
  constructor() {
    this.items = [];
    this.index = -1;
    this.repeat = "off";
    this.shuffle = false;
  }

  set(items, start) {
    this.items = Array.isArray(items) ? items.slice() : [];
    const requested = Number(start) || 0;
    this.index = this.items.length ? Math.max(0, Math.min(this.items.length - 1, requested)) : -1;
    return this.current();
  }

  add(track, next) {
    if (!track) return null;
    if (next && this.index >= 0) this.items.splice(this.index + 1, 0, track);
    else this.items.push(track);
    if (this.index < 0) this.index = 0;
    return track;
  }

  current() {
    return this.items[this.index] || null;
  }

  next(auto) {
    if (!this.items.length) return null;
    if (auto && this.repeat === "one") return this.current();
    if (this.index < this.items.length - 1) this.index += 1;
    else if (this.repeat === "all") this.index = 0;
    else return null;
    return this.current();
  }

  previous() {
    if (!this.items.length) return null;
    this.index = Math.max(0, this.index - 1);
    return this.current();
  }

  remove(index) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= this.items.length) return null;
    const [removed] = this.items.splice(i, 1);
    if (!this.items.length) this.index = -1;
    else if (i < this.index) this.index -= 1;
    else if (i === this.index && this.index >= this.items.length) this.index = this.items.length - 1;
    return removed;
  }

  clear() {
    this.items = [];
    this.index = -1;
  }

  shuffleUpcoming() {
    this.shuffle = !this.shuffle;
    if (!this.items.length) return this.shuffle;
    const head = this.items.slice(0, this.index + 1);
    const tail = this.items.slice(this.index + 1);
    for (let i = tail.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [tail[i], tail[j]] = [tail[j], tail[i]];
    }
    this.items = head.concat(tail);
    return this.shuffle;
  }

  cycleRepeat() {
    const order = ["off", "all", "one"];
    this.repeat = order[(order.indexOf(this.repeat) + 1) % order.length];
    return this.repeat;
  }

  toJSON() {
    return {
      items: this.items,
      index: this.index,
      current: this.current(),
      upcoming: this.index >= 0 ? this.items.slice(this.index + 1) : [],
      repeat: this.repeat,
      shuffle: this.shuffle,
    };
  }
}

module.exports = {
  cleanTitle,
  cleanArtist,
  splitArtistTitle,
  normalizeTrack,
  normalizeList,
  normalizeSearch,
  Queue,
};
