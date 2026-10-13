// What would this conversation have cost on AWS? (us-east-1 list prices, Lex V2 / Polly / Transcribe)
export const PRICES = {
  lexText: 0.00075,        // per text request
  lexSpeech: 0.004,        // per speech request
  pollyNeuralPerChar: 16 / 1e6,
  transcribePerSec: 0.024 / 60,
  lambdaPerReq: 0.0000002 + 0.0000166667 * 0.128 * 0.1, // request + 128MB × 100ms
};

/** Cost of a single turn. `turn` = { inputMode, audioSec, ttsChars, lambda } */
export function turnCost(turn) {
  const lex = turn.inputMode === 'Speech' ? PRICES.lexSpeech : PRICES.lexText;
  const transcribe = turn.inputMode === 'Speech' ? Math.max(15, turn.audioSec || 0) * PRICES.transcribePerSec : 0; // 15s minimum
  const polly = (turn.ttsChars || 0) * PRICES.pollyNeuralPerChar;
  const lambda = turn.lambda ? PRICES.lambdaPerReq : 0;
  return { lex, transcribe, polly, lambda, total: lex + transcribe + polly + lambda };
}

export const usd = (n) => (n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(2)}`);

/** Bytes that would have been sent to the cloud for this turn. */
export function turnBytes(turn) {
  const audio = turn.inputMode === 'Speech' ? Math.round((turn.audioSec || 0) * 16000 * 2) : 0; // 16kHz PCM16
  return audio + new TextEncoder().encode(turn.text || '').length;
}
