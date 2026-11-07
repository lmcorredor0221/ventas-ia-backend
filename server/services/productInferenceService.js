import { buildProductInferencePrompt } from '../prompts/catalogSemanticGuide.js';

export class ProductInferenceService {
  constructor({ planner }) {
    this.planner = planner;
  }

  async infer(input) {
    return this.planner.inferProducts(input);
  }

  static prompt(input) {
    return buildProductInferencePrompt(input);
  }
}
