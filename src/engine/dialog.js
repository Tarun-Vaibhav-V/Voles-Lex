// Dialog manager — re-implements the Amazon Lex V2 runtime state machine:
//   ElicitIntent → ElicitSlot (per required slot, with retries) → ConfirmIntent → Fulfillment → Close
// and returns responses shaped like the Lex V2 RecognizeText API.

import { classicInterpret } from './classicNlu.js';
import { llmInterpret } from './llmNlu.js';
import { resolveSlot } from './slotTypes.js';

const YES = /\b(yes|yeah|yep|yup|sure|ok|okay|correct|confirm|go ahead|right|absolutely|please do|do it|sounds good)\b/i;
const NO = /\b(no|nope|nah|don't|do not|cancel that|wrong|negative|not really)\b/i;
const CANCEL = /^\s*(cancel|stop|never ?mind|forget it|quit|abort)\b/i;
const MAX_RETRIES = 2;

export function newSession(sessionId = crypto.randomUUID()) {
  return { sessionId, intent: null, dialogAction: { type: 'ElicitIntent' }, sessionAttributes: {}, retries: 0 };
}

export function fill(template, slots = {}, attrs = {}) {
  return (template || '').replace(/\{(\w+)\}/g, (_, k) => slots[k] ?? attrs[k] ?? `{${k}}`);
}

function toLexSlots(intentDef, slots) {
  if (!intentDef) return {};
  return Object.fromEntries(intentDef.slots.map((s) => [s.name, slots[s.name]
    ? { value: { originalValue: slots[s.name], interpretedValue: slots[s.name], resolvedValues: [slots[s.name]] } }
    : null]));
}

/**
 * Process one user turn.
 * @param bot       bot definition (DRAFT or a version snapshot)
 * @param session   mutable internal session (from newSession)
 * @param text      user input transcript
 * @param opts      { nluMode: 'classic'|'llm', llmSettings, runCodeHook, aliasName, version }
 */
export async function recognizeText(bot, session, text, opts = {}) {
  const meta = { nlu: opts.nluMode || 'classic', inputTranscript: text, t0: performance.now() };
  const threshold = bot.nluThreshold ?? 0.4;
  const active = session.intent;
  const activeDef = active && bot.intents.find((i) => i.name === active.name);
  const say = [];

  // ---- 1. Interpretation ---------------------------------------------------
  let interp; // { intent, confidence, slots, confirmation }
  let interpretations = [];
  if (meta.nlu === 'llm') {
    try {
      interp = await llmInterpret(bot, text, session, opts.llmSettings);
      meta.llmMs = interp.ms;
      meta.model = interp.model;
      if (Object.keys(interp.rejected).length) meta.rejectedSlots = interp.rejected;
      if (interp.confidence < threshold && !session.intent) interp.intent = 'FallbackIntent';
      interpretations = [{ intent: { name: interp.intent, slots: toLexSlots(bot.intents.find((i) => i.name === interp.intent), interp.slots) }, nluConfidence: { score: interp.confidence } }];
    } catch (e) {
      meta.error = `LLM unavailable (${e.message}) — fell back to classic NLU`;
      meta.nlu = 'classic';
    }
  }
  if (meta.nlu === 'classic') {
    const ranked = classicInterpret(bot, text);
    const top = ranked[0] || { intent: 'FallbackIntent', confidence: 0, slots: {} };
    interp = {
      intent: top.confidence >= threshold ? top.intent : 'FallbackIntent',
      confidence: top.confidence,
      slots: top.slots,
      confirmation: YES.test(text) ? 'Confirmed' : NO.test(text) ? 'Denied' : 'None',
    };
    interpretations = ranked.slice(0, 3).map((r) => ({
      intent: { name: r.intent, slots: toLexSlots(bot.intents.find((i) => i.name === r.intent), r.slots) },
      nluConfidence: { score: r.confidence },
    }));
    // When a slot is being elicited, try to resolve the raw answer directly (Lex does this too).
    if (active && session.dialogAction.type === 'ElicitSlot') {
      const slotDef = activeDef?.slots.find((s) => s.name === session.dialogAction.slotToElicit);
      const v = slotDef && resolveSlot(bot, slotDef.type, text, { direct: true });
      if (v) interp.directSlot = { [slotDef.name]: v };
    }
  }
  if (!interpretations.some((i) => i.intent.name === 'FallbackIntent')) {
    interpretations.push({ intent: { name: 'FallbackIntent', slots: {} }, nluConfidence: null });
  }

  // ---- 2. Built-in cancel ---------------------------------------------------
  if (active && CANCEL.test(text)) {
    session.intent = { ...active, state: 'Failed' };
    return finish(bot, session, 'Close', ['Okay, I\'ve cancelled that.'], interpretations, meta, opts, { reset: true });
  }

  // ---- 3. Choose the intent ------------------------------------------------
  let intentName;
  const answering = active && ['ElicitSlot', 'ConfirmIntent'].includes(session.dialogAction.type);
  if (answering) {
    const switchBar = meta.nlu === 'llm' ? 0.75 : Math.min(0.95, threshold + 0.35);
    const wantsSwitch = interp.intent !== active.name && interp.intent !== 'FallbackIntent' &&
      interp.confidence >= switchBar && !interp.directSlot && session.dialogAction.type !== 'ConfirmIntent';
    intentName = wantsSwitch ? interp.intent : active.name;
  } else {
    intentName = interp.intent;
  }

  if (intentName === 'FallbackIntent' || !bot.intents.find((i) => i.name === intentName)) {
    meta.missed = true;
    session.intent = null;
    return finish(bot, session, 'ElicitIntent', [bot.fallbackMessage || "Sorry, I didn't understand. Can you rephrase?"], interpretations, meta, opts, { fallback: true });
  }

  const def = bot.intents.find((i) => i.name === intentName);
  if (!session.intent || session.intent.name !== intentName) {
    session.intent = { name: intentName, slots: Object.fromEntries(def.slots.map((s) => [s.name, null])), state: 'InProgress', confirmationState: 'None' };
    session.retries = 0;
  }
  const cur = session.intent;

  // ---- 4. Merge slot values ---------------------------------------------------
  const before = Object.values(cur.slots).filter(Boolean).length;
  const incoming = { ...(interp.intent === intentName ? interp.slots : {}), ...(interp.directSlot || {}) };
  for (const [k, v] of Object.entries(incoming)) if (v && k in cur.slots) cur.slots[k] = v;
  const gained = Object.values(cur.slots).filter(Boolean).length > before;

  // ---- 5. Confirmation answer -------------------------------------------------
  if (session.dialogAction.type === 'ConfirmIntent' && active?.name === intentName) {
    if (interp.confirmation === 'Confirmed') {
      cur.confirmationState = 'Confirmed';
    } else if (interp.confirmation === 'Denied' && !gained) {
      cur.confirmationState = 'Denied';
      cur.state = 'Failed';
      return finish(bot, session, 'Close', [fill(def.declinationResponse || 'Okay, I won\'t do that.', cur.slots, session.sessionAttributes)], interpretations, meta, opts, { reset: true });
    } else if (!gained) {
      return finish(bot, session, 'ConfirmIntent', [`Please say yes or no. ${fill(def.confirmationPrompt, cur.slots, session.sessionAttributes)}`], interpretations, meta, opts);
    }
  }

  // ---- 6. Elicit missing slots (with retries) ---------------------------------
  const missing = def.slots.find((s) => s.required && !cur.slots[s.name]);
  if (missing) {
    const sameSlot = session.dialogAction.type === 'ElicitSlot' && session.dialogAction.slotToElicit === missing.name && active?.name === intentName;
    if (sameSlot && !gained) {
      session.retries += 1;
      if (session.retries > MAX_RETRIES) {
        cur.state = 'Failed';
        meta.missed = true;
        return finish(bot, session, 'Close', ["Sorry, I'm having trouble understanding. Let's start over later."], interpretations, meta, opts, { reset: true });
      }
      meta.missed = true;
      return finish(bot, session, 'ElicitSlot', [fill(missing.retryPrompt || `Sorry, I didn't catch that. ${missing.prompt}`, cur.slots, session.sessionAttributes)], interpretations, meta, opts, { slot: missing.name });
    }
    session.retries = 0;
    return finish(bot, session, 'ElicitSlot', [fill(missing.prompt, cur.slots, session.sessionAttributes)], interpretations, meta, opts, { slot: missing.name });
  }

  // ---- 7. Ask for confirmation -----------------------------------------------
  if (def.confirmationPrompt && cur.confirmationState !== 'Confirmed') {
    return finish(bot, session, 'ConfirmIntent', [fill(def.confirmationPrompt, cur.slots, session.sessionAttributes)], interpretations, meta, opts);
  }

  // ---- 8. Fulfillment (mock Lambda code hook) ----------------------------------
  cur.state = 'ReadyForFulfillment';
  if (def.fulfillmentEnabled && bot.codeHook && opts.runCodeHook) {
    const event = {
      messageVersion: '1.0',
      invocationSource: 'FulfillmentCodeHook',
      inputMode: opts.inputMode || 'Text',
      inputTranscript: text,
      sessionId: session.sessionId,
      bot: { name: bot.name, aliasName: opts.aliasName || 'TestBotAlias', version: opts.version || 'DRAFT', localeId: bot.locale || 'en_US' },
      sessionState: {
        intent: { name: cur.name, slots: toLexSlots(def, cur.slots), state: cur.state, confirmationState: cur.confirmationState },
        sessionAttributes: { ...session.sessionAttributes },
      },
    };
    const h0 = performance.now();
    try {
      const res = await opts.runCodeHook(bot.codeHook, event);
      meta.lambdaMs = Math.round(performance.now() - h0);
      meta.lambdaLogs = res.logs;
      const out = res.result || {};
      if (out.sessionState?.sessionAttributes) session.sessionAttributes = { ...out.sessionState.sessionAttributes };
      const msgs = (out.messages || []).map((m) => m.content).filter(Boolean);
      const state = out.sessionState?.intent?.state || 'Fulfilled';
      cur.state = state;
      const action = out.sessionState?.dialogAction?.type || 'Close';
      if (action === 'ElicitSlot') {
        const slot = out.sessionState.dialogAction.slotToElicit;
        cur.slots[slot] = null;
        cur.state = 'InProgress';
        const sd = def.slots.find((s) => s.name === slot);
        return finish(bot, session, 'ElicitSlot', msgs.length ? msgs : [sd?.prompt || `What is ${slot}?`], interpretations, meta, opts, { slot });
      }
      return finish(bot, session, 'Close', msgs.length ? msgs : [fill(def.closingResponse || 'Done.', cur.slots, session.sessionAttributes)], interpretations, meta, opts, { reset: true });
    } catch (e) {
      meta.lambdaMs = Math.round(performance.now() - h0);
      meta.lambdaError = e.message;
      cur.state = 'Failed';
      return finish(bot, session, 'Close', ['Sorry, something went wrong while processing your request.'], interpretations, meta, opts, { reset: true });
    }
  }

  cur.state = 'Fulfilled';
  return finish(bot, session, 'Close', [fill(def.closingResponse || 'All done!', cur.slots, session.sessionAttributes)], interpretations, meta, opts, { reset: true });
}

function finish(bot, session, type, messages, interpretations, meta, opts, { slot, reset, fallback } = {}) {
  const intent = session.intent;
  const def = intent && bot.intents.find((i) => i.name === intent.name);
  session.dialogAction = slot ? { type, slotToElicit: slot } : { type };
  const response = {
    sessionId: session.sessionId,
    messages: messages.map((content) => ({ contentType: 'PlainText', content })),
    sessionState: {
      dialogAction: { ...session.dialogAction },
      intent: intent
        ? { name: intent.name, slots: toLexSlots(def, intent.slots), state: intent.state, confirmationState: intent.confirmationState }
        : { name: fallback ? 'FallbackIntent' : null, slots: {}, state: fallback ? 'Failed' : null },
      sessionAttributes: { ...session.sessionAttributes },
    },
    interpretations,
    requestAttributes: {},
  };
  meta.totalMs = Math.round(performance.now() - meta.t0);
  delete meta.t0;
  response._voxlex = meta;
  if (reset) {
    session.intent = null;
    session.retries = 0;
    session.dialogAction = { type: 'ElicitIntent' };
    response.sessionState.dialogAction = { type: 'Close' };
  }
  return response;
}
