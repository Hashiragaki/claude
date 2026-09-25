import { FRENCH_AUDIENCE_NOTE, editMessage, requestMessage } from '../shared/prompt';
import { jsonFile, pngFile } from '../shared/files';
import { sanitizeSvg } from '../svg/sanitize';
import type { GeneratorDefinition } from '../types';
import { proceduralAnim } from './procedural';
import { anim2dParamsSchema, anim2dSpecSchema, type Anim2dParams, type Anim2dSpec } from './schema';
import { buildAtlas, buildSheetSvg, sheetLayout } from './sheet';

const SYSTEM_PROMPT = `You are a 2D animator for Forge, a web game engine. You build "cut-out" animations: a few
vector parts (SVG fragments) moved by keyframes. The engine renders every frame into ONE sprite sheet PNG
(one row per animation, one column per frame) plus a PixiJS atlas.

Spec:
- width, height: size of ONE frame in pixels (16-256). fps: playback speed.
- parts: drawn back to front. Each part = { id, svg, pivot }:
  - svg: an SVG fragment WITHOUT <svg> root (path, circle, ellipse, rect, polygon, g, defs/gradients allowed), drawn
    in frame coordinates (0..width, 0..height) in its REST pose. Ids declared inside a fragment are automatically
    made unique. No <text>, <image>, <script>, external URLs or animations.
  - pivot: [x, y] center used for rotate and scale (e.g. the shoulder for an arm, the bottom center for a bouncing body).
- animations: [{ name, frames (1-16), loop, keys }]. name is lowercase ("idle", "walk", "attack", "hurt", "cast"...).
  keys: { part, frame, translate?: [dx, dy], rotate?: degrees, scale?: [sx, sy], opacity?: 0-1 }.
  Each property is interpolated linearly between the keys that define it (per part); before the first key and after
  the last key the value is held. Undefined properties stay at rest (translate [0,0], rotate 0, scale [1,1], opacity 1).
  Important: a property first set at a later key is held from frame 0, so always give every animated property its
  starting value in the part's first key (e.g. opacity 1 at frame 0 if it fades out later).
  For a seamless loop, put a key at frame = frames with the same values as frame 0 (that frame is not rendered).

Animation direction:
- Use squash & stretch, anticipation and follow-through; ease by adding intermediate keys (small then large steps).
- Keep everything inside the frame at every pose (leave ~8% margin), transparent background, centered subject,
  subjects standing on a common ground line (~90% of the height) with a soft shadow ellipse part.
- Effects (magic, fire, explosion, heal, sparkles): bright saturated core, glow made with radial gradients,
  particles that expand, rotate and fade; non-looping bursts end fully transparent.
- Readable at small size: bold shapes, dark tinted outlines (not pure black), 2-3 tones per material.
- Stay compact: at most ~12 parts and ~120 keys per animation, round numbers to 1 decimal.
${FRENCH_AUDIENCE_NOTE}`;

export const anim2dGenerator: GeneratorDefinition<Anim2dParams, Anim2dSpec> = {
  id: 'anim2d',
  kind: 'spritesheet',
  label: 'Animation 2D',
  description: 'Animation 2D en pièces découpées (effet, créature, objet, personnage) rendue en planche de sprites + atlas PixiJS.',
  paramsSchema: anim2dParamsSchema,
  specSchema: anim2dSpecSchema,
  systemPrompt: SYSTEM_PROMPT,
  buildPrompt(params) {
    return requestMessage(`a 2D cut-out animation (subject type: ${params.subject})`, params.prompt, params, [
      `Frame size: ${params.width}x${params.height}, ${params.frames} frames per animation, ${params.fps} fps.`,
      `Produce exactly these animations, in this order: ${params.animations.join(', ')}.`,
    ]);
  },
  buildEditPrompt(spec, instruction, params) {
    return editMessage(spec, instruction, params, ['Keep the same frame size, animation names and frame counts.']);
  },
  procedural(params, rng) {
    return proceduralAnim(params, rng);
  },
  async render(spec, _params, ctx) {
    const layout = sheetLayout(spec);
    const svg = sanitizeSvg(buildSheetSvg(spec), { width: layout.width, height: layout.height });
    const png = await ctx.rasterizeSvg(svg, layout.width, layout.height);
    return {
      files: [pngFile('main', png), jsonFile('atlas', buildAtlas(spec)), jsonFile('source', spec)],
      info: {
        frameWidth: spec.width,
        frameHeight: spec.height,
        fps: spec.fps,
        frames: layout.columns,
        animations: spec.animations.map((a) => a.name).join(','),
      },
    };
  },
};
