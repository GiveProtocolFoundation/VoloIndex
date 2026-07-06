/**
 * Volo Index — LLM Adapter (P0)
 *
 * Provider-agnostic interface for LLM completions.
 * v1 ships one concrete adapter (provider = board decision D1, pending).
 * MockLlmAdapter enables deterministic tests without any vendor SDK.
 */

/**
 * @typedef {Object} LlmMessage
 * @property {'system'|'user'|'assistant'} role
 * @property {string} content
 */

/**
 * @typedef {Object} LlmCompletionOpts
 * @property {number} [temperature=0]  - Sampling temperature
 * @property {number} [maxTokens=4096] - Max tokens in response
 * @property {Object} [jsonSchema]     - If set, request JSON-schema-constrained output
 */

/**
 * @typedef {Object} LlmCompletionResult
 * @property {string} text  - The completion text
 * @property {{ promptTokens: number, completionTokens: number }} usage
 */

/**
 * Abstract LLM adapter interface.
 * Concrete adapters extend this and implement `complete()`.
 */
export class LlmAdapter {
  /**
   * @param {LlmMessage[]} messages
   * @param {LlmCompletionOpts} [opts]
   * @returns {Promise<LlmCompletionResult>}
   */
  async complete(messages, opts) {
    throw new Error('LlmAdapter.complete() must be implemented by a concrete adapter');
  }
}

/**
 * Mock adapter for deterministic testing.
 * Returns canned responses keyed by the last user message content (or a default).
 */
export class MockLlmAdapter extends LlmAdapter {
  /**
   * @param {Map<string, string>|Object<string, string>} responses
   *   Keys: substrings to match against the last user message.
   *   Values: the text to return.
   *   A key of '*' serves as the fallback.
   */
  constructor(responses = {}) {
    super();
    this._responses = responses instanceof Map ? responses : new Map(Object.entries(responses));
    this._calls = [];
  }

  /** @returns {Array<{ messages: LlmMessage[], opts: LlmCompletionOpts }>} */
  get calls() { return this._calls; }

  async complete(messages, opts = {}) {
    this._calls.push({ messages, opts });

    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const content = lastUserMsg?.content ?? '';

    // Try substring match (longest key first for specificity)
    const keys = [...this._responses.keys()].filter(k => k !== '*').sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (content.includes(key)) {
        return this._result(this._responses.get(key));
      }
    }

    // Fallback
    if (this._responses.has('*')) {
      return this._result(this._responses.get('*'));
    }

    return this._result('{"signals":[]}');
  }

  _result(text) {
    return {
      text,
      usage: { promptTokens: 100, completionTokens: 50 },
    };
  }
}
