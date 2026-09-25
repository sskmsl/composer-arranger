import type { ClassicalJointModel, ClassicalModel, ClassicalModels } from "./classicalLikeness"
import classicalModelJson from "./reference/classicalModel.json"
import classicalJointModelJson from "./reference/classicalJointModel.json"

/** 古典らしさの物差し(実在の古典の旋律から作ったもの。作り方は melodyReference.calibration.test.ts と tools/melody-reference/) */
export const CLASSICAL_MODELS: ClassicalModels = {
  marginal: classicalModelJson as ClassicalModel,
  joint: classicalJointModelJson as ClassicalJointModel,
}
