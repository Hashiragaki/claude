export { model3dGenerator, model3dParamsSchema, MODEL_TEMPLATE_OPTIONS, type Model3dParams } from './model3d';
export {
  model3dSpecSchema,
  materialSchema,
  nodeSchema,
  shapeSchema,
  animationSchema,
  trackSchema,
  keySchema,
  validateModel,
  MAX_ANIMATIONS,
  MAX_MATERIALS,
  MAX_NODES,
  MAX_SEGMENTS,
  type AnimationSpec,
  type KeySpec,
  type MaterialSpec,
  type Model3dSpec,
  type NodeSpec,
  type ShapeSpec,
  type TrackSpec,
} from './dsl';
export { buildModel, eulerDegToQuat, MAX_TRIANGLES, type BuiltModel } from './build';
export { shapeMesh, type MeshData } from './geometry';
export { GENERIC_ANIMATIONS, normalizeAnimationNames } from './anim';
export {
  MODEL_TEMPLATES,
  MODEL_TEMPLATE_NAMES,
  detectTemplate,
  resolveTemplate,
  type ModelTemplate,
  type TemplateContext,
  type TemplateModel,
} from './templates';
