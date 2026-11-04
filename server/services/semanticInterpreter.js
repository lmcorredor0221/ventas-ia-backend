/**
 * Boundary for contextual language interpretation.
 *
 * The interpreter owns only the linguistic result of a turn. It must not
 * choose a SKU, calculate a price, assert stock, or execute a tool. Those
 * facts are resolved later by the catalog/domain layer.
 */
export class SemanticInterpreter {
  constructor({ provider, fallback, normalize, onFallback = null, clock = () => Date.now() }) {
    if (typeof provider !== 'function') throw new TypeError('SemanticInterpreter requires a provider function');
    if (typeof fallback !== 'function') throw new TypeError('SemanticInterpreter requires a fallback function');
    if (typeof normalize !== 'function') throw new TypeError('SemanticInterpreter requires a normalize function');
    this.provider = provider;
    this.fallback = fallback;
    this.normalize = normalize;
    this.onFallback = onFallback;
    this.clock = clock;
  }

  async interpret(input = {}) {
    const startedAt = this.clock();
    let generated;
    let executionMode = 'provider_api';
    let providerMetadata = null;
    let diagnostics = null;
    let fallbackError = null;

    try {
      generated = await this.provider(input);
      executionMode = generated?.executionMode ?? executionMode;
      providerMetadata = generated?.providerMetadata ?? null;
      diagnostics = generated?.diagnostics ?? null;
    } catch (error) {
      fallbackError = error;
      generated = await this.fallback(input, error);
      executionMode = generated?.executionMode ?? 'mock_structured_fallback';
      providerMetadata = generated?.providerMetadata ?? null;
      diagnostics = generated?.diagnostics ?? null;
      await this.onFallback?.({ input, error, generated });
    }

    const semanticFrame = this.normalize(generated?.plan ?? generated, {
      text: input.text ?? input.normalized?.text ?? '',
      messageId: input.normalized?.messageId ?? null,
      messageIds: input.normalized?.batchMessageIds ?? input.messageIds ?? [],
      conversation: input.conversation ?? null,
    });

    return {
      semanticFrame,
      executionMode,
      providerMetadata,
      diagnostics,
      durationMs: this.clock() - startedAt,
      fallbackError,
    };
  }
}
