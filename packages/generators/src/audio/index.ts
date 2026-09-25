export { sfxGenerator, renderSfxSamples, SFX_SAMPLE_RATE, SFX_MAX_SECONDS } from './sfx';
export {
  sfxParamsSchema,
  sfxSpecSchema,
  SFX_PRESETS,
  SFX_WAVES,
  type SfxParams,
  type SfxPreset,
  type SfxSpec,
} from './sfx-spec';
export { detectPreset, presetParams, resolvePreset } from './sfx-presets';
export { synthesizeSfxr, DEFAULT_SFXR_PARAMS, type SfxrOptions, type SfxrParams, type SfxrWave } from './sfxr';
export { musicGenerator } from './music';
export {
  musicParamsSchema,
  musicSpecSchema,
  musicTrackSchema,
  INSTRUMENTS,
  MOODS,
  MUSIC_MAX_SECONDS,
  type Instrument,
  type Mood,
  type MusicParams,
  type MusicSpec,
  type MusicTrack,
} from './music-spec';
export { composeMusic, resolveMood } from './composer';
export { renderSong, MUSIC_SAMPLE_RATE, type RenderedSong, type RenderSongOptions } from './song';
export {
  parseDrumTrack,
  parseNoteName,
  parsePitchedTrack,
  midiToNoteName,
  formatTokens,
  DRUM_HITS,
  type DrumEvent,
  type DrumHit,
  type PitchedEvent,
} from './notes';
export {
  adsrLevel,
  Biquad,
  midiToFrequency,
  NoiseSource,
  OnePole,
  polyBlep,
  pulseWave,
  renderDrum,
  renderVoice,
  sawWave,
  Svf,
  triangleWave,
  type Adsr,
  type PitchedInstrument,
  type VoiceContext,
} from './synth';
export { renderReverb, type ReverbOptions } from './reverb';
export { fadeIn, fadeOut, normalizePeak, peakOf, softClip, trailingSilenceEnd } from './dsp';
