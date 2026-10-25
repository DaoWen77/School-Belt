'use client';

import { create } from 'zustand';

export interface PlayerTrack {
  id: string;
  title: string;
  artist?: string;
  src: string;
  coverUrl?: string | null;
  channelId?: string | null;
}

interface PlayerState {
  queue: PlayerTrack[];
  currentId: string | null;
  playing: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  setQueue: (tracks: PlayerTrack[]) => void;
  addTrack: (track: PlayerTrack) => void;
  playTrack: (id: string) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  setVolume: (value: number) => void;
  setProgress: (currentTime: number, duration: number) => void;
  stop: () => void;
}

/** 常驻播放器：模块级 zustand，切换 SPA 视图不丢队列 */
export const usePlayerStore = create<PlayerState>((set) => ({
  queue: [],
  currentId: null,
  playing: false,
  volume: 0.7,
  currentTime: 0,
  duration: 0,
  setQueue: (tracks) =>
    set((state) => {
      const current = state.queue.find((track) => track.id === state.currentId);
      const nextQueue = current && !tracks.some((track) => track.id === current.id) ? [current, ...tracks] : tracks;
      return {
        queue: nextQueue,
        currentId: current?.id ?? state.currentId ?? nextQueue[0]?.id ?? null,
      };
    }),
  addTrack: (track) =>
    set((state) => {
      if (state.queue.some((item) => item.id === track.id)) return state;
      const queue = [...state.queue, track];
      return { queue, currentId: state.currentId ?? track.id };
    }),
  playTrack: (id) =>
    set((state) => ({
      currentId: id,
      playing: true,
      currentTime: 0,
    })),
  toggle: () =>
    set((state) => {
      if (!state.currentId && state.queue.length > 0) return { currentId: state.queue[0].id, playing: true };
      return { playing: !state.playing };
    }),
  next: () =>
    set((state) => {
      if (state.queue.length === 0) return state;
      const index = state.queue.findIndex((track) => track.id === state.currentId);
      const nextIndex = (index + 1) % state.queue.length;
      return { currentId: state.queue[nextIndex].id, playing: true, currentTime: 0 };
    }),
  prev: () =>
    set((state) => {
      if (state.queue.length === 0) return state;
      const index = state.queue.findIndex((track) => track.id === state.currentId);
      const prevIndex = (index - 1 + state.queue.length) % state.queue.length;
      return { currentId: state.queue[prevIndex].id, playing: true, currentTime: 0 };
    }),
  setVolume: (value) => set({ volume: Math.max(0, Math.min(1, value)) }),
  setProgress: (currentTime, duration) => set({ currentTime, duration }),
  stop: () => set({ playing: false }),
}));
