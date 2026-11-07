import { buildContextInterpreterPrompt } from '../prompts/catalogSemanticGuide.js';

export class ContextInterpreterService {
  constructor({ planner }) {
    this.planner = planner;
  }

  async interpret(input) {
    return this.planner.interpretContext(input);
  }

  static prompt(input) {
    return buildContextInterpreterPrompt(input);
  }
}
