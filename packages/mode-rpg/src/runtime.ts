import type { RuntimeContext } from '@forge/core';
import { HeadlessRpgRuntime } from './headless';

// Provisoire : remplacé par le runtime PixiJS.
export class RpgRuntime extends HeadlessRpgRuntime {
  constructor(ctx: RuntimeContext) {
    super(ctx);
  }
}
