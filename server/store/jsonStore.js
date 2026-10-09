import fs from 'node:fs';
import path from 'node:path';
import { createSeedState } from '../data/seed.js';

export class JsonStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.state = null;
  }

  load() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.state = createSeedState();
      this.save();
      return this.state;
    }
    this.state = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    return this.state;
  }

  getState() {
    if (!this.state) return this.load();
    return this.state;
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  mutate(mutator) {
    const state = this.getState();
    const result = mutator(state);
    this.save();
    return result;
  }
}
